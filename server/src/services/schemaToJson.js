// src/services/schemaToJson.js
import Database from "better-sqlite3"; // see note below; you can also use "sqlite3" if you prefer
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import fs from "fs";

export function schemaToJsonFile(sql, { filename = "database" } = {}) {
  // In-memory build for introspection
  const mem = new Database(":memory:");
  mem.pragma("foreign_keys = ON");
  mem.exec(sql);

  // List tables
  const tables = mem
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map(r => r.name);

  const result = { tables: {} };

  for (const t of tables) {
    const cols = mem.prepare(`PRAGMA table_info('${t.replace(/'/g, "''")}')`).all();
    result.tables[t] = {
      columns: cols.map(c => ({
        name: c.name,
        type: c.type,
        notNull: !!c.notnull,
        primaryKey: !!c.pk,
        default: c.dflt_value ?? null,
      })),
      rows: [], // keep empty for now; you can fill later if you add INSERTs
    };
  }
  mem.close();

  const id = randomBytes(8).toString("base64url");
  const jsonName = `${filename}.json`;
  const absPath = path.join(os.tmpdir(), `${id}-${jsonName}`);
  fs.writeFileSync(absPath, JSON.stringify(result, null, 2), "utf-8");

  return { id, filename: jsonName, absPath, mime: "application/json" };
}
