// server/src/controllers/queryController.js

// (keep) Node core
import fs from "fs";
import os from "os";
import path from "path";

// (keep) Project utils
import openai from "../utils/openaiClient.js";
import { setDb, getDb } from "../config/dbState.js";
import fileHandler from "../utils/fileHandler.js";
import Message from "../schemas/messageSchema.js";

// ADDED: feature flag — default OFF so no AI-simulated rows are returned
const ALLOW_AI_SIM =
  (process.env.ALLOW_AI_SIMULATION || "false").toLowerCase() === "true";

// (keep) Remove a trailing top-level LIMIT (and optional OFFSET) if present
function stripTrailingLimit(sql = "") {
  return sql.replace(/\blimit\s+\d+\s*(offset\s+\d+)?\s*;?\s*$/i, "").trim();
}

// (keep) SELECT/CTE direct execution on SQLite (uses better-sqlite3)
async function execSqliteSelect(dbPath, sql) {
  const cleaned = (sql || "").trim();
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

// ADDED: Execute INSERT/UPDATE/DELETE/etc. and return affected row count
async function execSqliteMutating(dbPath, sql) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.exec(sql);
    const info = db.prepare("SELECT changes() AS changes").get();
    return { changes: info?.changes ?? 0 };
  } finally {
    db.close();
  }
}

// ADDED: Build a temporary SQLite DB from .sql / .json / .csv so we always run against real data
async function ensureSqliteDbFromFile(filePath, originalName = "") {
  if (!filePath) return null;

  const lower = (originalName || filePath).toLowerCase();
  const looksSqlite = lower.endsWith(".db") || lower.endsWith(".sqlite");
  if (looksSqlite) return filePath;

  const { default: Database } = await import("better-sqlite3");
  const tmpDb = path.join(os.tmpdir(), `${Date.now()}-ingested.db`);
  const db = new Database(tmpDb);

  try {
    if (lower.endsWith(".sql")) {
      const sqlText = fs.readFileSync(filePath, "utf-8");
      const isPgDump =
        /PostgreSQL database dump|pg_dump|SET\s+statement_timeout/i.test(sqlText);

      if (!isPgDump) {
        // Plain SQLite DDL — try to execute directly
        db.exec(sqlText);
        return tmpDb;
      }

      // ---- Minimal PostgreSQL → SQLite importer for pg_dump ----
      // 1) CREATE TABLE (basic column types)
      // 2) COPY ... FROM stdin (tab-delimited) → INSERT
      // Skips: SET/ALTER/SCHEMA/GRANT/REVOKE/COMMENT/TRIGGER/FUNCTION/constraints
      const lines = sqlText.split(/\r?\n/);

      const skipStarts = [
        "SET ",
        "SELECT pg_catalog.set_config",
        "CREATE SCHEMA",
        "ALTER SCHEMA",
        "REVOKE ",
        "GRANT ",
        "COMMENT ON ",
      ];

      const normalizeType = (t) =>
        t
          .replace(/character varying\(\d+\)/gi, "TEXT")
          .replace(/\bvarchar\(\d+\)/gi, "TEXT")
          .replace(/\btext\b/gi, "TEXT")
          .replace(/\btime without time zone\b/gi, "TEXT")
          .replace(/\btimestamp without time zone\b/gi, "TEXT")
          .replace(/\btimestamp with time zone\b/gi, "TEXT")
          .replace(/\bdate\b/gi, "TEXT")
          .replace(/\bboolean\b/gi, "INTEGER")
          .replace(/\binteger\b/gi, "INTEGER")
          .replace(/\bsmallint\b/gi, "INTEGER")
          .replace(/\bbigint\b/gi, "INTEGER")
          .replace(/\bserial\b/gi, "INTEGER")
          .replace(/\bdouble precision\b/gi, "REAL")
          .replace(/\bnumeric\(\d+(,\s*\d+)?\)/gi, "REAL");

      const toSqliteName = (qname) => {
        // "public.users" -> "public_users" ; "\"public\".\"users\"" -> "public_users"
        const unq = qname.replace(/"/g, "");
        const parts = unq.split(".");
        return parts.length === 2 ? `${parts[0]}_${parts[1]}` : unq;
      };

      let i = 0;
      while (i < lines.length) {
        let line = lines[i].trim();

        // comments/blank
        if (!line || line.startsWith("--")) {
          i++;
          continue;
        }

        // skip known pg-only statements
        if (skipStarts.some((s) => line.startsWith(s))) {
          i++;
          continue;
        }

        // skip CREATE FUNCTION ... $$ ... $$;
        if (/^CREATE FUNCTION\b/i.test(line)) {
          i++;
          while (i < lines.length && !/\$\$\s*;?\s*$/.test(lines[i])) i++;
          i++; // skip "$$" end
          continue;
        }

        // skip CREATE TRIGGER ... ;
        if (/^CREATE TRIGGER\b/i.test(line)) {
          while (i < lines.length && !/;\s*$/.test(lines[i])) i++;
          i++; // skip ;
          continue;
        }

        // skip ALTER TABLE ... (constraints/fks)
        if (/^ALTER TABLE\b/i.test(line)) {
          while (i < lines.length && !/;\s*$/.test(lines[i])) i++;
          i++;
          continue;
        }

        // CREATE TABLE ... ( ... );
        if (/^CREATE TABLE\b/i.test(line)) {
          let chunk = line;
          i++;
          while (i < lines.length && !/\);\s*$/.test(lines[i])) {
            chunk += "\n" + lines[i];
            i++;
          }
          if (i < lines.length) chunk += "\n" + lines[i]; // include closing );
          i++;

          const m = chunk.match(/CREATE TABLE\s+([^\s(]+)\s*\(([\s\S]*)\);\s*$/i);
          if (!m) continue;
          const rawName = m[1]; // e.g., public.users
          const colsRaw = m[2]; // inside (...)

          const table = toSqliteName(rawName);

          // split top-level commas (naive but ok for common dumps)
          const colLines = colsRaw
            .split(/,(?![^()]*\))/)
            .map((s) => s.trim())
            .filter((s) => s && !/^CONSTRAINT\b/i.test(s));

          const cols = colLines
            .map((def) => {
              // "uid integer NOT NULL DEFAULT nextval(...)" -> ["uid","integer NOT NULL DEFAULT nextval(...)"]
              const parts = def.split(/\s+/);
              const colName = parts.shift().replace(/"/g, "");
              const rest = normalizeType(parts.join(" "));
              // strip NOT NULL / DEFAULT ... / PRIMARY KEY (handled loosely)
              const cleaned = rest
                .replace(/\bNOT NULL\b/gi, "")
                .replace(/\bDEFAULT\b[\s\S]*$/i, "")
                .replace(/\bPRIMARY KEY\b/gi, "");
              return `"${colName}" ${cleaned || "TEXT"}`.trim();
            })
            .filter(Boolean);

          const createSql = `CREATE TABLE "${table}" (${cols.join(", ")});`;
          db.exec(createSql);
          continue;
        }

        // COPY public.users (uid, name, ...) FROM stdin;
        if (/^COPY\b/i.test(line) && /FROM\s+stdin;?$/i.test(line)) {
          const m = line.match(
            /^COPY\s+([^\s(]+)\s*\(([^)]+)\)\s+FROM\s+stdin;?$/i
          );
          if (!m) {
            i++;
            continue;
          }
          const rawName = m[1];
          const table = toSqliteName(rawName);
          const columns = m[2].split(",").map((s) => s.replace(/"/g, "").trim());

          const placeholders = columns.map(() => "?").join(", ");
          const stmt = db.prepare(
            `INSERT INTO "${table}" (${columns
              .map((c) => `"${c}"`)
              .join(", ")}) VALUES (${placeholders})`
          );
          const tx = db.transaction((rows) => {
            for (const r of rows) stmt.run(r);
          });

          i++;
          const batch = [];
          while (i < lines.length && lines[i].trim() !== "\\.") {
            const row = lines[i].split("\t").map((v) => (v === "\\N" ? null : v));
            batch.push(row);
            if (batch.length >= 1000) tx(batch.splice(0));
            i++;
          }
          if (batch.length) tx(batch);
          i++; // skip "\."
          continue;
        }

        // Anything else: ignore
        i++;
      }

      return tmpDb;
    }

    if (lower.endsWith(".json")) {
      // If it’s an array, create table "data"; if object of tables, create each
      const raw = fs.readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      const tables = Array.isArray(json) ? { data: json } : json;

      const { default: Database } = await import("better-sqlite3");
      for (const [table, rows] of Object.entries(tables)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const cols = Object.keys(rows[0]);
        db.exec(
          `CREATE TABLE "${table}" (${cols.map((c) => `"${c}"`).join(", ")});`
        );
        const stmt = db.prepare(
          `INSERT INTO "${table}" (${cols
            .map((c) => `"${c}"`)
            .join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
        );
        const tx = db.transaction((items) => {
          for (const r of items) stmt.run(cols.map((c) => r[c]));
        });
        tx(rows);
      }
      return tmpDb;
    }

    if (lower.endsWith(".csv")) {
      // Minimal CSV support (comma-separated, header row, no quoted commas)
      const text = fs.readFileSync(filePath, "utf-8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) return tmpDb;
      const header = lines[0].split(",").map((s) => s.trim());
      db.exec(`CREATE TABLE data (${header.map((c) => `"${c}"`).join(", ")});`);
      const stmt = db.prepare(
        `INSERT INTO data (${header.map((c) => `"${c}"`).join(", ")})
         VALUES (${header.map(() => "?").join(", ")})`
      );
      const tx = db.transaction((rows) => {
        for (let i = 1; i < rows.length; i++) {
          const raw = rows[i].trim();
          if (!raw) continue;
          const vals = raw.split(",");
          const padded = header.map((_, idx) => (vals[idx] ?? "").trim());
          stmt.run(padded);
        }
      });
      tx(lines);
      return tmpDb;
    }

    // Unknown type → just return original; direct execute may error and we’ll report it
    return filePath;
  } finally {
    db.close();
  }
}

// (keep) Main controller
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

    // Strategy 1: Use explicit dbFileMessageId if provided
    if (dbFileMessageId) {
      try {
        console.log("Strategy 1: Looking for DB file with dbFileMessageId:", dbFileMessageId);
        const fileMsg = await Message.findById(dbFileMessageId);
        if (fileMsg?.file?.data) {
          const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
          fs.writeFileSync(tmpPath, fileMsg.file.data);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "explicit_dbFileMessageId";
          console.log("Strategy 1 SUCCESS:", tmpPath);
        } else {
          console.log("Strategy 1 FAILED: File message found but no file data");
        }
      } catch (err) {
        console.log("Strategy 1 ERROR:", err.message);
      }
    }

    // Strategy 2: Look up the message and use its dbFileMessageId
    if (!dbPath && messageId) {
      try {
        console.log("Strategy 2: Looking up message:", messageId);
        const msg = await Message.findById(messageId);
        if (msg?.dbFileMessageId) {
          const fileMsg = await Message.findById(msg.dbFileMessageId);
          if (fileMsg?.file?.data) {
            const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
            fs.writeFileSync(tmpPath, fileMsg.file.data);
            setDb(tmpPath);
            dbPath = tmpPath;
            foundVia = "message_dbFileMessageId";
            console.log("Strategy 2 SUCCESS:", tmpPath);
          } else {
            console.log("Strategy 2 FAILED: file data missing");
          }
        } else {
          console.log("Strategy 2 FAILED: message has no dbFileMessageId");
        }
      } catch (err) {
        console.log("Strategy 2 ERROR:", err.message);
      }
    }

    // Strategy 3: Find the most recent file in the thread
    if (!dbPath && threadId) {
      try {
        console.log("Strategy 3: Searching any file in thread:", threadId);
        const fileMsg = await Message.findOne({
          threadId,
          "file.data": { $exists: true, $ne: null },
        })
          .sort({ createdAt: -1 })
          .lean();

        if (fileMsg?.file?.data) {
          const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${fileMsg.file.name}`);
          fs.writeFileSync(tmpPath, fileMsg.file.data);
          setDb(tmpPath);
          dbPath = tmpPath;
          foundVia = "thread_search";
          console.log("Strategy 3 SUCCESS:", tmpPath);
        } else {
          console.log("Strategy 3 FAILED: no file data in thread");
        }
      } catch (err) {
        console.log("Strategy 3 ERROR:", err.message);
      }
    }

    // Strategy 4: Fall back to a globally set DB if present
    if (!dbPath) {
      const globalDb = getDb();
      if (globalDb) {
        dbPath = globalDb;
        foundVia = "global_fallback";
        console.log("Strategy 4: Using global DB:", dbPath);
      }
    }

    // If we have a path, convert non-DBs (.sql/.json/.csv) into a temp SQLite DB
    if (dbPath) {
      const ingested = await ensureSqliteDbFromFile(dbPath);
      if (ingested && ingested !== dbPath) {
        dbPath = ingested;
        setDb(dbPath);
      }
    }

    // Attempt real execution first
    const sqlToRun = fullExport ? stripTrailingLimit(query) : query;
    const isSelect = /^(select|with)\b/i.test(sqlToRun.trim());

    if (dbPath && fs.existsSync(dbPath)) {
      try {
        if (isSelect) {
          let rows = await execSqliteSelect(dbPath, sqlToRun);

          // If query used Postgres schema (public.users), retry with public_ rewrite on failure/empty?
          // Only retry if it *failed*, not when it returns rows. We do that in catch below.

          // Clean up temporary file if we created one
          if (foundVia !== "global_fallback" && dbPath && fs.existsSync(dbPath)) {
            setTimeout(() => {
              try {
                fs.unlinkSync(dbPath);
                console.log("Cleaned up temporary file:", dbPath);
              } catch (err) {
                console.warn("Failed to clean up temporary file:", err.message);
              }
            }, 1000);
          }

          return res.json({ rows, foundVia, mode: "sqlite" });
        } else {
          const { changes } = await execSqliteMutating(dbPath, sqlToRun);

          if (foundVia !== "global_fallback" && dbPath && fs.existsSync(dbPath)) {
            setTimeout(() => {
              try {
                fs.unlinkSync(dbPath);
                console.log("Cleaned up temporary file:", dbPath);
              } catch (err) {
                console.warn("Failed to clean up temporary file:", err.message);
              }
            }, 1000);
          }

          // Maintain "rows" shape for UI
          return res.json({ rows: [{ affected_rows: changes }], foundVia, mode: "sqlite" });
        }
      } catch (e) {
        console.warn("SQLite execution failed:", e.message);

        // ADDED: If query uses Postgres schema notation (public.users), retry with public_ prefix
        if (/\bpublic\./i.test(sqlToRun)) {
          try {
            const rewritten = sqlToRun.replace(/\bpublic\./gi, "public_");
            if (isSelect) {
              const rows = await execSqliteSelect(dbPath, rewritten);
              return res.json({ rows, foundVia, mode: "sqlite" });
            } else {
              const { changes } = await execSqliteMutating(dbPath, rewritten);
              return res.json({ rows: [{ affected_rows: changes }], foundVia, mode: "sqlite" });
            }
          } catch {
            // fall through to the error handling below
          }
        }
        // fall through to AI (if enabled) or error
      }
    }

    // (keep) AI simulation path — now gated behind env flag and OFF by default
    if (!ALLOW_AI_SIM) {
      return res.status(400).json({
        error: "Could not execute SQL against any database. (AI simulation is disabled)",
        debug: { foundVia, hadDb: !!dbPath },
      });
    }

    // (keep) Load schema for AI simulation
    const schema = await fileHandler(dbPath);
    console.log("Schema loaded:", Object.keys(schema));

    // (keep) Ask OpenAI to simulate running the query and return rows
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a SQL execution engine.
The user will give you:
1) A database schema in JSON.
2) An SQL query.
You must return only JSON rows that would result from running the query on that schema.
Use realistic sample data if needed.
Return the result as a JSON object with a "rows" array.`,
        },
        {
          role: "user",
          content: `Schema: ${JSON.stringify(schema, null, 2)}\n\nQuery: ${sqlToRun}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    // (keep) Parse AI JSON
    let rows = [];
    try {
      const raw = completion.choices[0].message.content;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rows = parsed;
      } else if (parsed.rows && Array.isArray(parsed.rows)) {
        rows = parsed.rows;
      } else if (parsed.data && Array.isArray(parsed.data)) {
        rows = parsed.data;
      } else {
        rows = Object.values(parsed).find((val) => Array.isArray(val)) || [];
      }
    } catch (err) {
      console.error("Failed to parse OpenAI response:", err.message);
      console.error("Raw response:", completion.choices[0].message.content);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    console.log(`Query executed successfully (AI), returning ${rows.length} rows`);

    return res.json({ rows, foundVia, mode: "ai" });
  } catch (err) {
    console.error("Run query error:", err);
    res.status(500).json({ error: err.message });
  }
};
