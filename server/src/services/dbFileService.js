// server/src/services/dbFileService.js
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3"; // npm i better-sqlite3

// ---- tiny helpers: bullets → schema → SQL ----
// ---- robust bullets → schema → SQL ----
export function parseBulletsToSchema(schemaText = "") {
  // Normalize to make matching predictable
  const text = (schemaText || "")
    .replace(/\r/g, "")
    .replace(/[–—•·▪●]/g, "-") // normalize various bullets to '-'
    .replace(/[*`_]/g, "") // drop md punctuation
    .replace(/Tables?\s*:/gi, " "); // drop "Tables:" label

  // 1) Primary: every token that follows a dash anywhere
  let tokens = [...text.matchAll(/-\s*([A-Za-z][\w]*)/g)].map((m) => m[1]);

  // 2) Fallback: if nothing matched, split on '-' (handles funky inputs)
  if (tokens.length === 0) {
    tokens = text
      .split("-")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Clean tokens
  tokens = tokens.filter(Boolean);

  // 3) Group tokens → tables
  const tables = [];
  let curr = null;

  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;

    // Start first table with *any* token (capitalize it)
    if (!curr) {
      const name = tok.charAt(0).toUpperCase() + tok.slice(1);
      curr = { name, columns: [] };
      tables.push(curr);
      continue;
    }

    // If token is Capitalized and current table already has columns → new table
    if (/^[A-Z]/.test(tok) && curr.columns.length > 0) {
      curr = { name: tok, columns: [] };
      tables.push(curr);
      continue;
    }

    // Otherwise treat as column
    curr.columns.push(tok);
  }

  if (tables.length > 0) return tables;

  // 4) Final fallback: "TableName: col1, col2, col3"
  const blocks = [
    ...text.matchAll(/([A-Za-z][\w]*)\s*:\s*([A-Za-z0-9_,\s]+)/g),
  ];
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
    const cols = [],
      fks = [];
    for (const c of t.columns) {
      cols.push(`"${c}" ${inferType(c)}`);
      if (/_id$/.test(c)) {
        const target = linkTarget(c, schema);
        if (target)
          fks.push(`FOREIGN KEY("${c}") REFERENCES "${target}"("id")`);
      }
    }
    out.push(
      `CREATE TABLE IF NOT EXISTS "${t.name}" (\n  ${cols
        .concat(fks)
        .join(",\n  ")}\n);`
    );
  }
  return out.join("\n\n");
}

// short-lived file store for /download/:id
export const fileMap = new Map(); // id -> { path, name }

export function makeFile({
  schemaText,
  sql,
  format = "sql",
  filename = "database",
}) {
  const safe = filename.replace(/[^\w.-]/g, "_");
  const ddl = sql || buildSql(parseBulletsToSchema(schemaText || ""));
  const id = Math.random().toString(36).slice(2);

  if (format === "sql") {
    const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.sql`);
    console.log("[makeFile] writing SQL file:", tmp);
    fs.writeFileSync(tmp, ddl, "utf8");
    fileMap.set(id, { path: tmp, name: `${safe}.sql` });
    return { id, filename: `${safe}.sql` };
  }

  if (format === "sqlite") {
    const tmp = path.join(os.tmpdir(), `${safe}-${Date.now()}.sqlite`);
    console.log("[makeFile] building .sqlite DB:", tmp);
    const db = new Database(tmp);
    db.pragma("foreign_keys = ON");
    db.exec(ddl); // ← this RUNS your SQL
    db.close();
    fileMap.set(id, { path: tmp, name: `${safe}.sqlite` });
    return { id, filename: `${safe}.sqlite` };
  }

  throw new Error(`Unsupported format: ${format}`);
}
