//src/config/dbState.js
let dbPath = null;

export function setDb(path) {
  dbPath = path;
}

export function getDb() {
  return dbPath;
}
