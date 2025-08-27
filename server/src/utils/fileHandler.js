const fs = require('fs');
const path = require('path');

// CSV Handler
const handleCSV = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstLine = content.split(/\r?\n/)[0];
    return { CSV_File: firstLine.split(',').map(h => h.trim()) };
  } catch (err) {
    return { error: `CSV parsing failed: ${err.message}` };
  }
};

// JSON Handler
const handleJSON = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const columns = {};

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

    return columns;
  } catch (err) {
    return { error: `JSON parsing failed: ${err.message}` };
  }
};

// SQL Handler
const handleSQL = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const regex = /CREATE\s+TABLE\s+(?:["`]?(\w+)["`]?\.)?["`]?(\w+)["`]?\s*\(([^;]+)\)/gi;
    let match;
    const columns = {};

    while ((match = regex.exec(content)) !== null) {
      const schema = match[1];       // optional schema
      const tableName = match[2];    // table name
      const colsBlock = match[3];

      const cols = colsBlock
        .split(/,\s*\n?/)
        .map(line => line.trim().split(/\s+/)[0])
        .filter(col => col && !/^constraint$/i.test(col));

      columns[schema ? `${schema}.${tableName}` : tableName] = cols;
    }

    if (Object.keys(columns).length === 0) {
      return { SQL_File: ['(No CREATE TABLE statements detected)'] };
    }

    return columns;
  } catch (err) {
    return { error: `SQL parsing failed: ${err.message}` };
  }
};

// Main Handler
const handleFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') return handleCSV(filePath);
  if (ext === '.json') return handleJSON(filePath);
  if (ext === '.sql') return handleSQL(filePath);

  throw new Error('Unsupported file type: ' + ext);
};

module.exports = handleFile;
