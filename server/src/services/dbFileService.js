import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3"; // npm i better-sqlite3
import { randomBytes } from "crypto";

// ---- bullets → schema → SQL ----
export function parseBulletsToSchema(schemaText = "") {
  const text = (schemaText || "")
    .replace(/\r/g, "")
    .replace(/[–—•·▪●]/g, "-")
    .replace(/[*`_]/g, "")
    .replace(/Tables?\s*:/gi, " ");

  let tokens = [...text.matchAll(/-\s*([A-Za-z][\w]*)/g)].map((m) => m[1]);
  if (tokens.length === 0) {
    tokens = text.split("-").map((s) => s.trim()).filter(Boolean);
  }
  tokens = tokens.filter(Boolean);

  const tables = [];
  let curr = null;

  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;

    if (!curr) {
      const name = tok.charAt(0).toUpperCase() + tok.slice(1);
      curr = { name, columns: [] };
      tables.push(curr);
      continue;
    }

    if (/^[A-Z]/.test(tok) && curr.columns.length > 0) {
      curr = { name: tok, columns: [] };
      tables.push(curr);
      continue;
    }

    curr.columns.push(tok);
  }

  if (tables.length > 0) return tables;

  const blocks = [...text.matchAll(/([A-Za-z][\w]*)\s*:\s*([A-Za-z0-9_,\s]+)/g)];
  if (blocks.length) {
    return blocks.map(([, name, cols]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      columns: cols.split(/\s*,\s*/).filter(Boolean),
    }));
  }

  return [];
}

const inferType = (c) =>
  c === "id"
    ? "INTEGER PRIMARY KEY"
    : /_id$/.test(c)
    ? "INTEGER"
    : /date|time/i.test(c)
    ? "TEXT"
    : /total|amount|price|score/i.test(c)
    ? "REAL"
    : "TEXT";

const linkTarget = (c, ts) => {
  const cand = c.replace(/_id$/, "");
  const name = cand.charAt(0).toUpperCase() + cand.slice(1);
  return ts.find((t) => t.name === name)?.name || null;
};

export function buildSql(schema) {
  const out = ["PRAGMA foreign_keys = ON;"];
  for (const t of schema) {
    const cols = [];
    const fks = [];
    for (const c of t.columns) {
      cols.push(`${c} ${inferType(c)}`);
      if (/_id$/.test(c)) {
        const target = linkTarget(c, schema);
        if (target) fks.push(`FOREIGN KEY(${c}) REFERENCES ${target}(id)`);

      }
    }
    out.push(
      `CREATE TABLE IF NOT EXISTS ${t.name} (\n  ${cols.concat(fks).join(",\n  ")}\n);`
    );
  }
  return out.join("\n\n");
}

// ---- short-lived file store for /download/:id
// id -> { path, name, mime }
export const fileMap = new Map();

function newId() {
  return randomBytes(8).toString("base64url");
}

export function registerFile({ absPath, filename, mime = "application/octet-stream" }) {
  const id = newId();
  fileMap.set(id, { path: absPath, name: filename, mime });
  return { id, filename };
}

export function getFileMeta(id) {
  return fileMap.get(id) || null;
}

// ---- creators: .sql / .sqlite(.db) / .json
export function makeFile({ schemaText, sql, format = "sql", filename = "database" }) {
  const safe = filename.replace(/[^\w.-]/g, "_");
  const ddl = sql || buildSql(parseBulletsToSchema(schemaText || ""));
  const id = newId();

  if (format === "sql") {
    const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.sql`);
    console.log("[makeFile] writing SQL file:", tmp);
    fs.writeFileSync(tmp, ddl, "utf8");
    fileMap.set(id, { path: tmp, name: `${safe}.sql`, mime: "application/sql" });
    return { id, filename: `${safe}.sql` };
  }

  if (format === "sqlite" || format === "db") {
    const ext = format === "db" ? "db" : "sqlite";
    const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.${ext}`);
    console.log("[makeFile] building .sqlite DB:", tmp);
    const db = new Database(tmp);
    db.pragma("foreign_keys = ON");
    db.exec(ddl);
    db.close();
    fileMap.set(id, { path: tmp, name: `${safe}.${ext}`, mime: "application/x-sqlite3" });
    return { id, filename: `${safe}.${ext}` };
  }

  throw new Error(`Unsupported format: ${format}`);
}

export function makeJsonFile({ schemaText, sql, filename = "database" }) {
  const safe = filename.replace(/[^\w.-]/g, "_");
  const ddl = sql || buildSql(parseBulletsToSchema(schemaText || ""));

  const mem = new Database(":memory:");
  mem.pragma("foreign_keys = ON");
  mem.exec(ddl);

  const tables = mem
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);

  const dump = { tables: {} };

  for (const t of tables) {
    const cols = mem.prepare(`PRAGMA table_info('${t.replace(/'/g, "''")}')`).all();
    const fks = mem.prepare(`PRAGMA foreign_key_list('${t.replace(/'/g, "''")}')`).all();

    dump.tables[t] = {
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        notNull: !!c.notnull,
        primaryKey: !!c.pk,
        default: c.dflt_value ?? null,
      })),
      foreignKeys: fks.map((f) => ({
        table: f.table,
        from: f.from,
        to: f.to,
        onUpdate: f.on_update,
        onDelete: f.on_delete,
      })),
      rows: [],
    };
  }
  mem.close();

  const id = newId();
  const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(dump, null, 2), "utf8");
  fileMap.set(id, { path: tmp, name: `${safe}.json`, mime: "application/json" });
  return { id, filename: `${safe}.json` };
}
