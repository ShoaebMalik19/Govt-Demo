// Minimal file-backed datastore. Real persistence, no external DB service required.
//
// This project lives inside a OneDrive-synced folder. OneDrive periodically takes a
// transient lock on files while syncing, which makes plain fs.writeFile fail with
// EBUSY/EPERM/EPERM-style errors every so often -- that's not corruption, just a race
// with the sync client. The write path below is built to tolerate that:
//   1. cache (in memory) is always the source of truth for reads, so a failed disk
//      write never makes the app misbehave -- it only risks losing the very latest
//      write if the process dies before a retry succeeds.
//   2. every write retries a few times with backoff before giving up.
//   3. writes go to a temp file + atomic rename, so a failed/interrupted write can
//      never leave db.json half-written / corrupted.
//   4. a .bak copy is kept so a corrupted primary file can still be recovered.
//   5. persist() never rejects -- callers don't await it, so a rejected promise here
//      would otherwise become an unhandled rejection and crash the whole server.
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const BAK_PATH = DB_PATH + ".bak";
const TMP_PATH = DB_PATH + ".tmp";

let cache = null;
let writeQueue = Promise.resolve();

function readJsonSafe(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function load() {
  if (!cache) {
    try {
      cache = readJsonSafe(DB_PATH);
    } catch (err) {
      console.error(`[db] db.json unreadable/corrupt (${err.message}), trying backup...`);
      try {
        cache = readJsonSafe(BAK_PATH);
        console.warn("[db] recovered from db.json.bak");
      } catch (err2) {
        console.error("[db] no usable backup either -- starting from an empty schema", err2.message);
        cache = { citizens: [], applications: [], documents: [], grievances: [], payments: [], notifications: [], messages: [], seq: { app: 1, grv: 1, pay: 1, citizen: 1 } };
      }
    }
  }
  return cache;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function writeOnce() {
  const json = JSON.stringify(cache, null, 2);
  // Keep a backup of whatever is currently on disk before we overwrite it.
  try { await fs.promises.copyFile(DB_PATH, BAK_PATH); } catch (_) { /* fine on first run */ }
  await fs.promises.writeFile(TMP_PATH, json, "utf8");
  await fs.promises.rename(TMP_PATH, DB_PATH); // atomic on the same volume
}

async function writeWithRetry() {
  const delays = [50, 150, 400, 900, 1800];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await writeOnce();
      return;
    } catch (err) {
      const transient = ["EBUSY", "EPERM", "EACCES", "ENOENT"].includes(err.code);
      if (attempt < delays.length && transient) {
        await sleep(delays[attempt]);
        continue;
      }
      // Give up on this write. cache already holds the correct in-memory state, so
      // the app keeps serving correct data -- we just log instead of crashing.
      console.error(`[db] write to db.json failed after ${attempt + 1} attempt(s), will retry on next change:`, err.message);
      return;
    }
  }
}

function persist() {
  // Serialize writes so concurrent requests can't interleave and corrupt the file.
  // Deliberately swallow rejections here: persist() is fire-and-forget everywhere it's
  // called, so a rejected promise with no .catch() would otherwise be an unhandled
  // rejection -- and Node kills the whole process on those by default.
  writeQueue = writeQueue.then(writeWithRetry, writeWithRetry);
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
