const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PORT = process.env.PORT || 4300;
const COLLECTIONS = ['accounts', 'tags', 'sections', 'trips', 'transactions', 'investmentTrades'];

function emptyStore() {
  return Object.fromEntries(COLLECTIONS.map((name) => [name, {}]));
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
function mergeCollection(existing, incoming) {
  for (const record of incoming ?? []) {
    if (!record?.id) continue;
    const current = existing[record.id];
    if (!current || String(record.updatedAt ?? '') >= String(current.updatedAt ?? '')) {
      existing[record.id] = record;
    }
  }
}

const store = loadStore();
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

app.post('/api/sync', (request, response) => {
  const { since, entities } = request.body ?? {};
  for (const name of COLLECTIONS) {
    mergeCollection(store[name], entities?.[name]);
  }
  saveStore(store);

  const responseEntities = {};
  for (const name of COLLECTIONS) {
    const values = Object.values(store[name]);
    responseEntities[name] = since ? values.filter((record) => String(record.updatedAt ?? '') > since) : values;
  }
  response.json({ serverTime: new Date().toISOString(), entities: responseEntities });
});

app.listen(PORT, () => console.log(`finance-backend listening on port ${PORT}`));
