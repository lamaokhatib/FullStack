// analyzeFile.js
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();

async function analyzeFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let columns = {};

  if (ext === '.xlsx') {
    // Excel: all sheets
    const buffer = fs.readFileSync(filePath);
    const workbook = xlsx.read(buffer);
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const headers = [];
      const range = xlsx.utils.decode_range(sheet['!ref']);
      const firstRow = range.s.r;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[xlsx.utils.encode_cell({ r: firstRow, c })];
        headers.push(cell ? cell.v : `Column${c + 1}`);
      }
      columns[sheetName] = headers;
    });

  } else if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstLine = content.split(/\r?\n/)[0];
    columns["CSV_File"] = firstLine.split(',').map(h => h.trim());

  } else if (ext === '.json' || ext === '.txt') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (typeof data === 'object' && !Array.isArray(data)) {
      for (const [tableName, rows] of Object.entries(data)) {
        if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object') {
          columns[tableName] = Object.keys(rows[0]);
        } else {
          columns[tableName] = ['(No columns detected)'];
        }
      }
    } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      columns["JSON_Array"] = Object.keys(data[0]);
    } else {
      columns["JSON"] = ['(Not a tabular structure)'];
    }

  } else if (ext === '.db') {
    columns = await readSqliteColumns(filePath);

  } else if (ext === '.sql') {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Support schema-qualified table names like "public.users"
    const regex = /CREATE\s+TABLE\s+(?:["`]?(\w+)["`]?\.)?["`]?(\w+)["`]?\s*\(([^;]+)\)/gi;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const schema = match[1];       // e.g. "public"
      const tableName = match[2];    // e.g. "users"
      const colsBlock = match[3];

      const cols = colsBlock
        .split(/,\s*\n?/)
        .map(line => line.trim().split(/\s+/)[0]) // first token = column name
        .filter(col => col && !/^constraint$/i.test(col));

      columns[schema ? `${schema}.${tableName}` : tableName] = cols;
    }

    if (Object.keys(columns).length === 0) {
      columns["SQL_File"] = ['(No CREATE TABLE statements detected)'];
    }

  } else {
    throw new Error('Unsupported file type: ' + ext);
  }

  return columns;
}

function readSqliteColumns(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });

    db.all("SELECT name FROM sqlite_master WHERE type='table';", [], (err, tables) => {
      if (err) return reject(err);

      const results = {};
      let pending = tables.length;

      if (pending === 0) {
        db.close();
        return resolve(results);
      }

      tables.forEach((t) => {
        db.all(`PRAGMA table_info(${t.name});`, [], (err, rows) => {
          if (err) results[t.name] = [`Error: ${err.message}`];
          else results[t.name] = rows.map(r => r.name);

          if (--pending === 0) {
            db.close();
            resolve(results);
          }
        });
      });
    });
  });
}

module.exports = analyzeFile;
