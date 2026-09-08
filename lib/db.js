// Minimal file-backed datastore. Real persistence, no external DB service required.
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
let cache = null;
let writeQueue = Promise.resolve();

function load() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  }
  return cache;
}

function persist() {
  // Serialize writes so concurrent requests can't interleave and corrupt the file.
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(DB_PATH, JSON.stringify(cache, null, 2), "utf8")
  );
  return writeQueue;
}

function getAll(collection) {
  return load()[collection] || [];
}

function findOne(collection, predicate) {
  return getAll(collection).find(predicate);
}

function insert(collection, doc) {
  const db = load();
  if (!db[collection]) db[collection] = [];
  db[collection].push(doc);
  persist();
  return doc;
}

function update(collection, predicate, patch) {
  const db = load();
  const item = (db[collection] || []).find(predicate);
  if (item) Object.assign(item, patch);
  persist();
  return item;
}

function nextId(prefix, seqKey) {
  const db = load();
  const n = db.seq[seqKey]++;
  persist();
  return `${prefix}-${n}`;
}

module.exports = { load, persist, getAll, findOne, insert, update, nextId };
