const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = process.env.PORT || 4300;
const COLLECTIONS = ['accounts', 'tags', 'sections', 'trips', 'transactions', 'investmentTrades'];
const DELETABLE_COLLECTIONS = new Set(['tags', 'transactions']);

function emptyStore() {
  return { ...Object.fromEntries(COLLECTIONS.map((name) => [name, {}])), tombstones: {} };
}

function loadStore() {
  if (!fs.existsSync(DB_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    return { ...emptyStore(), ...parsed };
  } catch {
    return emptyStore();
  }
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(store), 'utf-8');
}

/** Last-write-wins merge of incoming records into the persisted collection. */
function mergeCollection(existing, incoming, tombstones, collection) {
  for (const record of incoming ?? []) {
    if (!record?.id) continue;
    const tombstone = tombstones[`${collection}:${record.id}`];
    if (tombstone && String(tombstone.deletedAt) >= String(record.updatedAt ?? '')) continue;
    if (tombstone) delete tombstones[`${collection}:${record.id}`];
    const current = existing[record.id];
    if (!current || String(record.updatedAt ?? '') >= String(current.updatedAt ?? '')) {
      existing[record.id] = record;
    }
  }
}

function mergeTombstones(store, incoming) {
  for (const tombstone of incoming ?? []) {
    if (!tombstone?.id || !DELETABLE_COLLECTIONS.has(tombstone.collection)) continue;
    const key = `${tombstone.collection}:${tombstone.id}`;
    const current = store.tombstones[key];
    if (current && String(current.deletedAt) > String(tombstone.deletedAt)) continue;
    const record = store[tombstone.collection][tombstone.id];
    if (record && String(record.updatedAt ?? '') > String(tombstone.deletedAt)) continue;
    delete store[tombstone.collection][tombstone.id];
    store.tombstones[key] = tombstone;
  }
}

const store = loadStore();
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

app.post('/api/sync', (request, response) => {
  const { entities } = request.body ?? {};
  for (const name of COLLECTIONS) {
    mergeCollection(store[name], entities?.[name], store.tombstones, name);
  }
  mergeTombstones(store, entities?.tombstones);
  saveStore(store);

  const responseEntities = {};
  for (const name of COLLECTIONS) {
    responseEntities[name] = Object.values(store[name]);
  }
  responseEntities.tombstones = Object.values(store.tombstones);
  response.json({ serverTime: new Date().toISOString(), entities: responseEntities });
});

app.listen(PORT, () => console.log(`finance-backend listening on port ${PORT}`));
