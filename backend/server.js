const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
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

const PYTR_SCRIPT = path.join(__dirname, 'pytr_bridge.py');
const PYTR_MARKER = '@@PYTR@@';
const PYTR_COMMANDS = [process.env.PYTHON_BIN, ...(process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'])].filter(Boolean);
const PYTR_SESSION_TTL = 15 * 60 * 1000;
const pytrSessions = new Map();

function spawnPython(command) {
  return new Promise((resolve) => {
    const child = spawn(command, [PYTR_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.once('error', () => resolve(null));
    child.once('spawn', () => resolve(child));
  });
}

function createPytrSession(child) {
  const session = { id: crypto.randomUUID(), child, queue: [], waiters: [], stderr: '' };
  const deliver = (message) => {
    const waiter = session.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      session.queue.push(message);
    }
  };

  let buffer = '';
  child.stdout.setEncoding('utf-8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const marker = line.indexOf(PYTR_MARKER);
      if (marker < 0) continue;
      try {
        deliver(JSON.parse(line.slice(marker + PYTR_MARKER.length)));
      } catch {
        /* ignore malformed protocol lines */
      }
    }
  });
  child.stderr.setEncoding('utf-8');
  child.stderr.on('data', (chunk) => { session.stderr = (session.stderr + chunk).slice(-2000); });
  child.on('close', () => deliver({ event: 'error', message: `pytr wurde beendet. ${session.stderr.trim()}`.trim() }));

  session.send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
  session.next = (timeoutMs) => new Promise((resolve) => {
    const queued = session.queue.shift();
    if (queued) return resolve(queued);
    const timer = setTimeout(() => {
      session.waiters = session.waiters.filter((waiter) => waiter.timer !== timer);
      resolve({ event: 'error', message: 'Zeitüberschreitung bei pytr.' });
    }, timeoutMs);
    session.waiters.push({ resolve, timer });
  });
  session.dispose = () => {
    clearTimeout(session.ttl);
    pytrSessions.delete(session.id);
    child.kill();
  };
  session.ttl = setTimeout(() => session.dispose(), PYTR_SESSION_TTL);
  return session;
}

const store = loadStore();
const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

app.post('/api/pytr/start', async (request, response) => {
  const { phone, pin } = request.body ?? {};
  if (!phone || !pin) return response.status(400).json({ error: 'Telefonnummer und PIN werden benötigt.' });

  let child = null;
  for (const command of PYTR_COMMANDS) {
    child = await spawnPython(command);
    if (child) break;
  }
  if (!child) return response.status(500).json({ error: 'Kein Python gefunden. Bitte Python mit installiertem pytr bereitstellen (PYTHON_BIN setzt den Pfad).' });

  const session = createPytrSession(child);
  session.send({ phone, pin });
  const message = await session.next(180_000);
  if (message.event !== 'need_code') {
    session.dispose();
    return response.status(400).json({ error: message.message ?? 'Login fehlgeschlagen.' });
  }
  pytrSessions.set(session.id, session);
  response.json({ sessionId: session.id, countdown: message.countdown ?? null });
});

app.post('/api/pytr/code', async (request, response) => {
  const { sessionId, code } = request.body ?? {};
  const session = pytrSessions.get(sessionId);
  if (!session) return response.status(404).json({ error: 'Login-Sitzung abgelaufen. Bitte erneut starten.' });

  session.send({ code: code ?? '' });
  let message = await session.next(600_000);
  while (message.event === 'progress') message = await session.next(600_000);
  session.dispose();
  if (message.event !== 'done') return response.status(400).json({ error: message.message ?? 'Export fehlgeschlagen.' });
  response.json({ csv: message.csv });
});

app.post('/api/pytr/cancel', (request, response) => {
  pytrSessions.get(request.body?.sessionId)?.dispose();
  response.json({ status: 'ok' });
});

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
