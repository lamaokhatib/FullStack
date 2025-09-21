// server/src/controllers/queryController.js

// Node core
import fs from "fs";
import os from "os";
import path from "path";

// Project utils
import openai from "../utils/openaiClient.js";
import { setDb, getDb } from "../config/dbState.js";
import Message from "../schemas/messageSchema.js";

// ===== Feature flags =====
// OFF: never fabricate rows
const ALLOW_AI_SIM =
  (process.env.ALLOW_AI_SIMULATION || "false").toLowerCase() === "true";

// ON: let AI rewrite *statements* that fail during .sql ingestion (safe)
const ALLOW_AI_SQL_INGEST =
  (process.env.ALLOW_AI_SQL_INGEST || "true").toLowerCase() === "true";

// ON: let AI repair *queries* (SELECT/WITH) that fail at runtime (safe)
const ALLOW_AI_SQL_REWRITE =
  (process.env.ALLOW_AI_SQL_REWRITE || "true").toLowerCase() === "true";

// ===== Helpers =====
function toBuffer(maybeBinary) {
  if (!maybeBinary) return null;
  if (Buffer.isBuffer(maybeBinary)) return maybeBinary;
  if (maybeBinary?.buffer) return Buffer.from(maybeBinary.buffer);
  if (Array.isArray(maybeBinary?.data)) return Buffer.from(maybeBinary.data);
  try { return Buffer.from(maybeBinary); } catch { return null; }
}

function stripTrailingLimit(sql = "") {
  return sql.replace(/\blimit\s+\d+\s*(offset\s+\d+)?\s*;?\s*$/i, "").trim();
}

function stripCodeFences(s = "") {
  return (s || "")
    .replace(/```(?:sql)?/gi, "")
    .replace(/```/g, "")
    .trim()
    .replace(/^["'`](.*)["'`]$/s, "$1");
}

// Detect likely schema prefixes from SQLite table list (public_users → "public")
function detectSchemaPrefixes(sqliteTables = []) {
  const prefixes = new Set();
  for (const { name } of sqliteTables) {
    const m = /^([A-Za-z]\w+)_\w+$/.exec(name);
    if (m) prefixes.add(m[1]);
  }
  return Array.from(prefixes);
}

// Rewrite schema-qualified names (schema.table → schema_table), including quoted
function rewriteSchemaRefs(sql, schemas = ["public"]) {
  let out = sql;
  for (const s of schemas) {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "schema"."table" -> "schema_table"
    out = out.replace(new RegExp(`"${esc}"\\s*\\.\\s*"(\\w+)"`, "gi"), `"${s}_$1"`);
    // schema."table" -> "schema_table"
    out = out.replace(new RegExp(`\\b${esc}\\s*\\.\\s*"(\\w+)"`, "gi"), `"${s}_$1"`);
    // "schema".table -> "schema_table"
    out = out.replace(new RegExp(`"${esc}"\\s*\\.\\s*(\\w+)`, "gi"), `"${s}_$1"`);
    // schema.table -> schema_table
    out = out.replace(new RegExp(`\\b${esc}\\s*\\.\\s*(\\w+)`, "gi"), `${s}_$1`);
  }
  return out;
}

// Execute SELECT/CTE
async function execSqliteSelect(dbPath, sql) {
  const cleaned = stripCodeFences(sql);
  if (!/^(select|with)\b/i.test(cleaned)) {
    throw new Error("Only SELECT/CTE queries are supported for direct execution");
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const stmt = db.prepare(cleaned);
    return stmt.all();
  } finally {
    db.close();
  }
}

// Execute INSERT/UPDATE/DELETE…
async function execSqliteMutating(dbPath, sql) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.exec(stripCodeFences(sql));
    const info = db.prepare("SELECT changes() AS changes").get();
    return { changes: info?.changes ?? 0 };
  } finally {
    db.close();
  }
}

// Build (table → columns) and table list
async function readSqliteSchema(dbPath) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    const schema = {};
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
      schema[name] = cols.map((c) => c.name);
    }
    return { schema, tables };
  } finally {
    db.close();
  }
}

// AI: rewrite SQL (SELECT/WITH) into valid SQLite using exact tables/columns
async function aiRewriteSqlToSqlite({ sql, tables, schema, prefixes, error }) {
  const messages = [
    {
      role: "system",
      content:
        "You are a SQL fixer. Rewrite the user's SQL into a SQLite-compatible SQL query that will run on the provided tables/columns. " +
        "Respect the table names exactly as given. If the SQL uses schema-qualified names like public.users, rewrite to the SQLite table name (e.g., public_users). " +
        "Only return a runnable SQL string. No comments, no explanations, no DDL. Prefer SELECT/WITH. Never fabricate data.",
    },
    {
      role: "user",
      content:
`SQLite tables and columns:
${Object.entries(schema).map(([t, cols]) => `- ${t}(${cols.join(", ")})`).join("\n")}

Schema prefixes to map to underscore form:
${prefixes.join(", ") || "(none)"}

Original SQL (may be Postgres/MySQL):
${sql}

SQLite engine error:
${error}

Rewrite the SQL into valid SQLite (SELECT/WITH only). Return ONLY the SQL.`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  return stripCodeFences(completion.choices?.[0]?.message?.content || "");
}

// AI: fix one failing SQL *statement* (during ingestion) into SQLite form
async function aiFixSqlChunkForSqlite({ chunk, knownTables = [], note = "" }) {
  if (!ALLOW_AI_SQL_INGEST) throw new Error("AI SQL ingest disabled");
  const tableList = knownTables.length ? `SQLite tables already created:\n- ${knownTables.join("\n- ")}\n\n` : "";
  const messages = [
    {
      role: "system",
      content:
        "Rewrite the provided SQL *statement* so it runs in SQLite. " +
        "If it is PostgreSQL-specific (schemas like public.books, COPY, ON CONFLICT DO NOTHING, ONLY, ::casts, ILIKE), convert it. " +
        "If the statement is not needed in SQLite (e.g., CREATE SCHEMA, GRANT, COMMENT), return exactly: -- SKIP.\n" +
        "Return *only* runnable SQL or -- SKIP. No explanations."
    },
    {
      role: "user",
      content:
`${tableList}${note ? `Note: ${note}\n\n` : ""}Original statement:
${chunk}`
    }
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages
  });
  let fixed = stripCodeFences(completion.choices?.[0]?.message?.content || "");
  return fixed;
}

// Ingest .sql/.json/.csv to a temp SQLite DB; robust Postgres pg_dump support & messy files
async function ensureSqliteDbFromFile(filePath, originalName = "") {
  if (!filePath) return null;

  const lower = (originalName || filePath).toLowerCase();
  const looksSqlite = lower.endsWith(".db") || lower.endsWith(".sqlite");
  if (looksSqlite) return filePath;

  const { default: Database } = await import("better-sqlite3");
  const tmpDb = path.join(os.tmpdir(), `${Date.now()}-ingested.db`);
  const db = new Database(tmpDb);

  // helper: does table exist?
  const tableExists = (name) => {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
    return !!row;
  };
  // helper: create basic table with TEXT columns from a column list
  const ensureTable = (name, columns) => {
    if (tableExists(name)) return;
    const cols = columns.map((c) => `"${c}" TEXT`).join(", ");
    db.exec(`CREATE TABLE "${name}" (${cols});`);
  };

  try {
    if (lower.endsWith(".sql")) {
      const rawText = fs.readFileSync(filePath, "utf-8");

      const isPgLike = /PostgreSQL database dump|pg_dump|SET\s+|CREATE\s+SCHEMA|COPY\s+.+\s+FROM\s+stdin|OWNER TO|ALTER TABLE|INSERT\s+INTO|::|ILIKE/i.test(rawText);

      // fast path: plain SQLite with no schema dots
      if (!isPgLike && !/\b(create|insert|update|delete|from|join)\b[^;]*\w+\s*\.\s*\w+/i.test(rawText)) {
        db.exec(rawText);
        return tmpDb;
      }

      const lines = rawText.split(/\r?\n/);

      const skipStarts = [
        "SET ",
        "SELECT pg_catalog.set_config",
        "CREATE SCHEMA",
        "ALTER SCHEMA",
        "REVOKE ",
        "GRANT ",
        "COMMENT ON ",
        "CREATE EXTENSION",
        "ALTER SEQUENCE",
        "DROP SCHEMA",
        "LOCK TABLE",
        "COMMIT",
        "BEGIN",
        "\\connect"
      ];

      const toSqliteName = (qname) => {
        const unq = qname.replace(/"/g, "");
        const parts = unq.split(".");
        return parts.length === 2 ? `${parts[0]}_${parts[1]}` : unq;
      };

      // track created tables for AI hints
      const createdTables = new Set();

      // helper: run a chunk; on failure, try deterministic rewrite; if still fails → AI
      const runChunkWithAiRepair = async (chunk, note = "") => {
        const sanitized = stripCodeFences(chunk).trim();
        if (!sanitized) return;

        // Deterministic quick fixes
        let sql = sanitized
          .replace(/\bONLY\s+/gi, "")
          .replace(/\bOVERRIDING\s+SYSTEM\s+VALUE\b/gi, "")
          .replace(/\bON\s+CONFLICT\s+DO\s+NOTHING\b/gi, "")
          .replace(/\bUSING\b\s+\w+\s*\(([^)]+)\)/gi, "")
          .replace(/\bRETURNS\b[\s\S]*?\bAS\b/gi, "")
          .replace(/\bLANGUAGE\b\s+\w+/gi, "")
          .replace(/\bOWNER\s+TO\b[^\s;]+;?/gi, "")
          .replace(/::\s*\w+/g, "")
          .replace(/\bILIKE\b/gi, "LIKE");

        // strip REFERENCES ... in column defs (FKs)
        sql = sql.replace(/\bREFERENCES\b[\s\S]*?(?=,|\))/gi, "");

        // global schema rewrite
        sql = rewriteSchemaRefs(sql, ["public"]);

        try {
          db.exec(sql);
          return;
        } catch (e) {
          if (!ALLOW_AI_SQL_INGEST) throw e;
          const fixed = await aiFixSqlChunkForSqlite({
            chunk: sql,
            knownTables: Array.from(createdTables),
            note
          });
          if (!fixed || /^--\s*SKIP/i.test(fixed)) return;

          // Guard: if AI tried "ADD COLUMN ... PRIMARY KEY" (SQLite can't), split it
          const mAddColPk = fixed.match(
            /ALTER\s+TABLE\s+("?[\w]+"?)\s+ADD\s+COLUMN\s+("?[\w]+"?).*?PRIMARY\s+KEY/iu
          );
          if (mAddColPk) {
            const table = mAddColPk[1].replace(/"/g, "");
            const col = mAddColPk[2].replace(/"/g, "");
            const withoutPk = fixed.replace(/PRIMARY\s+KEY/gi, ""); // add the column without PK
            try { db.exec(withoutPk); } catch {}
            try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}__${col}__pk" ON "${table}" ("${col}");`); } catch {}
            return;
          }

          db.exec(fixed);
        }
      };

      let i = 0;
      while (i < lines.length) {
        let line = lines[i].trim();

        // skip comments, blanks, and ellipsis placeholders
        if (!line || line.startsWith("--") || line === "..." || line === "…") { i++; continue; }

        // skip pure pg/meta lines
        if (skipStarts.some((s) => line.startsWith(s))) { i++; continue; }

        // 1) CREATE TABLE … ( … );
        if (/^CREATE\s+TABLE\b/i.test(line)) {
          let chunk = line; i++;
          while (i < lines.length && !/\);\s*;?\s*$/.test(lines[i])) {
            chunk += "\n" + lines[i]; i++;
          }
          if (i < lines.length) chunk += "\n" + lines[i];
          i++;

          const m = chunk.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*?)\)\s*;?$/i);
          if (m) {
            const rawName = m[1], colsRaw = m[2];
            const table = toSqliteName(rawName);

            const colLines = colsRaw
              .split(/,(?![^()]*\))/)
              .map((s) => s.trim())
              .filter(Boolean);

            const cols = colLines
              .filter((s) => !/^CONSTRAINT\b/i.test(s))
              .map((def) => {
                const parts = def.split(/\s+/);
                const colName = parts.shift().replace(/"/g, "");
                let rest = parts.join(" ");
                rest = rest
                  .replace(/character varying\(\d+\)/gi, "TEXT")
                  .replace(/\bvarchar\(\d+\)/gi, "TEXT")
                  .replace(/\btext\b/gi, "TEXT")
                  .replace(/\btime without time zone\b/gi, "TEXT")
                  .replace(/\btimestamp (with|without) time zone\b/gi, "TEXT")
                  .replace(/\bdate\b/gi, "TEXT")
                  .replace(/\bboolean\b/gi, "INTEGER")
                  .replace(/\b(in|small|big)?integer\b/gi, "INTEGER")
                  .replace(/\bserial\b/gi, "INTEGER")
                  .replace(/\bdouble precision\b/gi, "REAL")
                  .replace(/\bnumeric\(\d+(,\s*\d+)?\)/gi, "REAL")
                  .replace(/\bNOT NULL\b/gi, "")
                  .replace(/\bDEFAULT\b[\s\S]*$/i, "")
                  .replace(/\bPRIMARY KEY\b/gi, "");
                return `"${colName}" ${rest || "TEXT"}`.trim();
              });

            try {
              db.exec(`CREATE TABLE "${table}" (${cols.join(", ")});`);
              createdTables.add(table);
            } catch (e) {
              await runChunkWithAiRepair(chunk, "CREATE TABLE failed");
            }
          } else {
            await runChunkWithAiRepair(chunk, "Unparsed CREATE TABLE");
          }
          continue;
        }

        // 2) COPY public.table (cols) FROM stdin;  (tab-separated)  ...  \.
        if (/^COPY\b/i.test(line) && /FROM\s+stdin;?$/i.test(line)) {
          const m = line.match(/^COPY\s+([^\s(]+)\s*\(([^)]+)\)\s+FROM\s+stdin;?$/i);
          if (!m) { i++; continue; }
          const rawName = m[1];
          const table = toSqliteName(rawName);
          const columns = m[2].split(",").map(s => s.replace(/"/g, "").trim());

          if (!tableExists(table)) {
            const cols = columns.map(c => `"${c}" TEXT`).join(", ");
            db.exec(`CREATE TABLE "${table}" (${cols});`);
            createdTables.add(table);
          }

          const placeholders = columns.map(() => "?").join(", ");
          const stmt = db.prepare(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`);
          const tx = db.transaction((rows) => { for (const r of rows) stmt.run(r); });

          i++;
          const batch = [];
          while (i < lines.length && lines[i].trim() !== "\\.") {
            if (lines[i].trim() === "..." || lines[i].trim() === "…") { i++; continue; }
            const row = lines[i].split("\t").map(v => (v === "\\N" ? null : v));
            batch.push(row);
            if (batch.length >= 1000) tx(batch.splice(0));
            i++;
          }
          if (batch.length) tx(batch);
          i++; // skip "\."
          continue;
        }

        // 2a) ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY (...);  → UNIQUE INDEX
        if (/^ALTER\s+TABLE\b/i.test(line)) {
          let chunk = line; i++;
          while (i < lines.length && !/;\s*$/.test(lines[i])) { chunk += "\n" + lines[i]; i++; }
          if (i < lines.length) chunk += "\n" + lines[i];
          i++;

          const mPk = chunk.match(
            /ALTER\s+TABLE\s+ONLY?\s+([^\s]+)[\s\S]*?ADD\s+CONSTRAINT\s+(\w+)\s+PRIMARY\s+KEY\s*\(([^)]+)\)/i
          );
          if (mPk) {
            const rawTable = mPk[1];
            const cols = mPk[3].split(",").map(s => s.replace(/"/g, "").trim());
            const table = toSqliteName(rawTable);
            const idxName = `${table}__pk`;
            const idxSql = `CREATE UNIQUE INDEX IF NOT EXISTS "${idxName}" ON "${table}" (${cols.map(c => `"${c}"`).join(", ")});`;
            try { db.exec(idxSql); } catch {}
            continue;
          }

          // Skip other constraints (FKs etc)
          if (/ADD\s+CONSTRAINT\b/i.test(chunk) || /\bFOREIGN\s+KEY\b/i.test(chunk)) {
            continue;
          }

          // otherwise: try repair
          await runChunkWithAiRepair(chunk, "ALTER TABLE fallback");
          continue;
        }

        // 3) INSERT INTO [ONLY] public.table (...) VALUES (...), (...);
        if (/^INSERT\s+INTO\b/i.test(line)) {
          let chunk = line; i++;
          while (i < lines.length && !/;\s*$/.test(lines[i])) {
            chunk += "\n" + lines[i]; i++;
          }
          if (i < lines.length) chunk += "\n" + lines[i];
          i++;

          try {
            // Rewrite schema refs, ensure table exists from column list
            let sql = rewriteSchemaRefs(chunk, ["public"]);
            const m = sql.match(/INSERT\s+INTO\s+("?[\w]+"?(?:\s*\.\s*"?[\w]+"?)?)\s*\(([^)]+)\)\s+VALUES/i);
            if (m) {
              const raw = m[1].replace(/"/g, "").replace(/\s/g, "");
              const table = toSqliteName(raw);
              const columns = m[2].split(",").map((s) => s.replace(/"/g, "").trim());
              ensureTable(table, columns);
              sql = sql.replace(m[1], `"${table}"`);
            }
            // drop ONLY keyword
            sql = sql.replace(/\bONLY\s+/gi, "");
            db.exec(sql);
          } catch (e) {
            const alt = rewriteSchemaRefs(
              chunk.replace(/\bONLY\s+/gi, "").replace(/\bOVERRIDING\s+SYSTEM\s+VALUE\b/gi, ""),
              ["public"]
            );
            try { db.exec(alt); } catch { await runChunkWithAiRepair(chunk, "INSERT fallback"); }
          }
          continue;
        }

        // 4) Any other statement: collect until ';' and run with repair
        if (!/;\s*$/.test(line)) {
          let chunk = line; i++;
          while (i < lines.length && !/;\s*$/.test(lines[i])) { chunk += "\n" + lines[i]; i++; }
          if (i < lines.length) chunk += "\n" + lines[i];
          i++;
          await runChunkWithAiRepair(chunk);
          continue;
        } else {
          await runChunkWithAiRepair(line);
          i++;
          continue;
        }
      }

      return tmpDb;
    }

    if (lower.endsWith(".json")) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      const tables = Array.isArray(json) ? { data: json } : json;
      for (const [table, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        db.exec(`CREATE TABLE "${table}" (${cols.map((c) => `"${c}"`).join(", ")});`);
        const stmt = db.prepare(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
        );
        const tx = db.transaction((items) => { for (const r of items) stmt.run(cols.map((c) => r[c])); });
        tx(rows);
      }
      return tmpDb;
    }

    if (lower.endsWith(".csv")) {
      const text = fs.readFileSync(filePath, "utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return tmpDb;
      const header = lines[0].split(",").map((s) => s.trim());
      db.exec(`CREATE TABLE data (${header.map((c) => `"${c}"`).join(", ")});`);
      const stmt = db.prepare(
        `INSERT INTO data (${header.map((c) => `"${c}"`).join(", ")})
         VALUES (${header.map(() => "?").join(", ")})`
      );
      const tx = db.transaction((rows) => {
        for (let i = 1; i < rows.length; i++) {
          const vals = rows[i].split(",");
          const padded = header.map((_, idx) => (vals[idx] ?? "").trim());
          stmt.run(padded);
        }
      });
      tx(lines);
      return tmpDb;
    }

    return filePath;
  } finally {
    db.close();
  }
}

// If a SELECT returns 0 rows, try mapping base table names to schema_table (e.g., users → public_users)
async function aliasRetryIfEmpty(dbPath, sql, prefixes = ["public"]) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name);

    const aliasMap = {};
    for (const t of tables) {
      const m = /^([A-Za-z]\w+)_(\w+)$/.exec(t);
      if (m && prefixes.includes(m[1])) {
        const base = m[2];
        if (!aliasMap[base]) aliasMap[base] = t; // first seen
      }
    }

    let rewritten = sql;
    let changed = false;
    for (const base of Object.keys(aliasMap)) {
      const re = new RegExp(`\\b${base}\\b`, "g");
      if (re.test(rewritten)) {
        rewritten = rewritten.replace(re, `"${aliasMap[base]}"`);
        changed = true;
      }
    }
    return changed ? rewritten : null;
  } finally {
    db.close();
  }
}

// ===== Main controller =====
export const runSqlQuery = async (req, res) => {
  try {
    const { query, messageId, threadId, dbFileMessageId, fullExport } = req.body;

    if (!query?.trim()) {
      return res.status(400).json({ error: "No SQL query provided." });
    }

    let dbPath = null;
    let foundVia = "unknown";

    console.log("=== SQL Query Execution Debug ===");
    console.log("Request params:", { messageId, threadId, dbFileMessageId });

    // Strategy 1: explicit DB file reference
    if (dbFileMessageId) {
      try {
        const fileMsg = await Message.findById(dbFileMessageId);
        if (fileMsg?.file?.data) {
          const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
          const buf = toBuffer(fileMsg.file.data);
          if (!buf) throw new Error("Could not convert file binary to Buffer");
          fs.writeFileSync(tmpPath, buf);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "explicit_dbFileMessageId";
        }
      } catch (err) {
        console.log("Strategy 1 ERROR:", err.message);
      }
    }

    // Strategy 2: use message’s dbFileMessageId
    if (!dbPath && messageId) {
      try {
        const msg = await Message.findById(messageId);
        if (msg?.dbFileMessageId) {
          const fileMsg = await Message.findById(msg.dbFileMessageId);
          if (fileMsg?.file?.data) {
            const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
            const buf = toBuffer(fileMsg.file.data);
            if (!buf) throw new Error("Could not convert file binary to Buffer");
            fs.writeFileSync(tmpPath, buf);
            setDb(tmpPath);
            dbPath = tmpPath;
            foundVia = "message_dbFileMessageId";
          }
        }
      } catch (err) {
        console.log("Strategy 2 ERROR:", err.message);
      }
    }

    // Strategy 3: any file in thread
    if (!dbPath && threadId) {
      try {
        const fileMsg = await Message.findOne({
          threadId,
          "file.data": { $exists: true, $ne: null },
        }).sort({ createdAt: -1 });

        if (fileMsg?.file?.data) {
          const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
          const buf = toBuffer(fileMsg.file.data);
          if (!buf) throw new Error("Could not convert file binary to Buffer");
          fs.writeFileSync(tmpPath, buf);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "thread_search";
        }
      } catch (err) {
        console.log("Strategy 3 ERROR:", err.message);
      }
    }

    // Strategy 4: global fallback
    if (!dbPath) {
      const globalDb = getDb();
      if (globalDb) {
        dbPath = globalDb;
        foundVia = "global_fallback";
      }
    }

    // Ingest to real SQLite if needed
    if (dbPath) {
      const ingested = await ensureSqliteDbFromFile(dbPath);
      if (ingested && ingested !== dbPath) {
        dbPath = ingested;
        setDb(dbPath);
      }
    }

    // Build schema & prefixes for rewrites
    let schemaInfo = { schema: {}, tables: [] };
    try { if (dbPath && fs.existsSync(dbPath)) schemaInfo = await readSqliteSchema(dbPath); } catch {}
    const prefixes = detectSchemaPrefixes(schemaInfo.tables);

    // Prepare SQL
    const originalSql = stripCodeFences(query);
    const sqlPrepared = rewriteSchemaRefs(fullExport ? stripTrailingLimit(originalSql) : originalSql, prefixes.length ? prefixes : ["public"]);
    const isSelect = /^(select|with)\b/i.test(sqlPrepared.trim());

    // Execute
    if (dbPath && fs.existsSync(dbPath)) {
      try {
        if (isSelect) {
          let rows = await execSqliteSelect(dbPath, sqlPrepared);

          // If empty, try alias rewrite like users -> public_users (or other detected prefixes)
          if (!rows || rows.length === 0) {
            const aliasSql = await aliasRetryIfEmpty(dbPath, sqlPrepared, prefixes.length ? prefixes : ["public"]);
            if (aliasSql && aliasSql !== sqlPrepared) {
              try {
                const rows2 = await execSqliteSelect(dbPath, aliasSql);
                if (rows2 && rows2.length) {
                  return res.json({ rows: rows2, foundVia, mode: "sqlite", aliasRewritten: true });
                }
              } catch { /* fall through; we'll return the original empty result below */ }
            }
          }

          return res.json({ rows, foundVia, mode: "sqlite" });
        } else {
          const { changes } = await execSqliteMutating(dbPath, sqlPrepared);
          return res.json({ rows: [{ affected_rows: changes }], foundVia, mode: "sqlite" });
        }
      } catch (e) {
        // Second-pass schema rewrite and retry
        try {
          const second = rewriteSchemaRefs(sqlPrepared, prefixes.length ? prefixes : ["public"]);
          if (second !== sqlPrepared) {
            if (isSelect) {
              const rows = await execSqliteSelect(dbPath, second);
              return res.json({ rows, foundVia, mode: "sqlite" });
            } else {
              const { changes } = await execSqliteMutating(dbPath, second);
              return res.json({ rows: [{ affected_rows: changes }], foundVia, mode: "sqlite" });
            }
          }
        } catch { /* ignore and fall through */ }

        // AI SQL REPAIR (not row simulation) — only for SELECT/WITH
        if (ALLOW_AI_SQL_REWRITE && isSelect) {
          try {
            const fixed = await aiRewriteSqlToSqlite({
              sql: sqlPrepared,
              tables: schemaInfo.tables,
              schema: schemaInfo.schema,
              prefixes: prefixes.length ? prefixes : ["public"],
              error: e.message || String(e),
            });
            if (fixed) {
              const rows = await execSqliteSelect(dbPath, fixed);
              return res.json({ rows, foundVia, mode: "sqlite", rewritten: true });
            }
          } catch (e2) {
            console.warn("AI SQL rewrite failed:", e2.message);
          }
        }

        if (!ALLOW_AI_SIM) {
          return res.status(400).json({ error: `Could not execute SQL: ${e.message}` });
        }
      }
    }

    // (Disabled by default) — AI "simulate rows" path
    if (!ALLOW_AI_SIM) {
      return res.status(400).json({
        error: "Could not execute SQL against any database. (AI simulation is disabled)",
        debug: { foundVia, hadDb: !!dbPath },
      });
    }

    // Optional simulation (testing only)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Return ONLY a JSON object with a 'rows' array simulating the SELECT results. Do not explain." },
        { role: "user", content: stripCodeFences(sqlPrepared) },
      ],
      response_format: { type: "json_object" },
    });

    let rows = [];
    try {
      const raw = completion.choices[0].message.content;
      const parsed = JSON.parse(raw);
      rows = Array.isArray(parsed) ? parsed :
             Array.isArray(parsed.rows) ? parsed.rows :
             Array.isArray(parsed.data) ? parsed.data :
             Object.values(parsed).find((v) => Array.isArray(v)) || [];
    } catch {
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    return res.json({ rows, foundVia, mode: "ai" });
  } catch (err) {
    console.error("Run query error:", err);
    res.status(500).json({ error: err.message });
  }
};
