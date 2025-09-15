// Simple database state manager for SQL file uploads
let dbPath = null;

export function setDb(path) {
  dbPath = path;
}

export function getDb() {
  return dbPath;
}
