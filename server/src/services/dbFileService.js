// server/src/services/dbFileService.js
import fs from "fs";
import os from "os";
import path from "path";


// ---- tiny helpers: bullets → schema → SQL ----
export function parseBulletsToSchema(schemaText = "") {
  const lines = schemaText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = lines.filter(l => l.startsWith("-")).map(l => l.replace(/^[-*]\s*/, ""));
  const tables = []; let curr = null;
  const isTable = s => /^[A-Z]/.test(s);
  for (const t of items) isTable(t)
    ? (curr = { name: t, columns: [] }, tables.push(curr))
    : curr && curr.columns.push(t);
  return tables;
}
const inferType = c => c==="id" ? "INTEGER PRIMARY KEY"
  : /_id$/.test(c) ? "INTEGER"
  : /date|time/i.test(c) ? "TEXT"
  : /total|amount|price|score/i.test(c) ? "REAL" : "TEXT";

const linkTarget = (c, ts) => {
  const cand = c.replace(/_id$/, "");
  const name = cand.charAt(0).toUpperCase() + cand.slice(1);
  return ts.find(t => t.name === name)?.name || null;
};

export function buildSql(schema) {
  const out = ['PRAGMA foreign_keys = ON;'];
  for (const t of schema) {
    const cols = [], fks = [];
    for (const c of t.columns) {
      cols.push(`"${c}" ${inferType(c)}`);
      if (/_id$/.test(c)) {
        const target = linkTarget(c, schema);
        if (target) fks.push(`FOREIGN KEY("${c}") REFERENCES "${target}"("id")`);
      }
    }
    out.push(`CREATE TABLE IF NOT EXISTS "${t.name}" (\n  ${cols.concat(fks).join(",\n  ")}\n);`);
  }
  return out.join("\n\n");
}

// short-lived file store for /download/:id
export const fileMap = new Map(); // id -> { path, name }

export function makeFile({ schemaText, sql, format = "sqlite", filename = "database" }) {
  const safe = filename.replace(/[^\w.-]/g, "_");
  const sqlText = sql || buildSql(parseBulletsToSchema(schemaText || ""));

  if (format === "sql") {
    const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.sql`);
    fs.writeFileSync(tmp, sqlText, "utf8");
    const id = Math.random().toString(36).slice(2);
    fileMap.set(id, { path: tmp, name: `${safe}.sql` });
    return { id, filename: `${safe}.sql` };
  }

  const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.sqlite`);
  const db = new Database(tmp);
  db.exec(sqlText);
  db.close();
  const id = Math.random().toString(36).slice(2);
  fileMap.set(id, { path: tmp, name: `${safe}.sqlite` });
  return { id, filename: `${safe}.sqlite` };
}
