// Per-device play state. GitHub Pages has no server, so the state is kept on the
// phone itself, mirrored into localStorage, a cookie and IndexedDB. The most
// "used up" copy wins, so clearing only one of them does not reset the limit.

const KEY = "mid-autumn-riddles-v3";
const DB_NAME = "mid-autumn-riddles";
const STORE = "state";

// State: { riddles: { [id]: { attempts, solved, solvedAt } }, deviceId }
const empty = () => ({ riddles: {}, deviceId: null });

function merge(...states) {
  const out = empty();
  for (const s of states) {
    if (!s) continue;
    for (const [id, r] of Object.entries(s.riddles ?? {})) {
      const cur = (out.riddles[id] ??= { attempts: 0, solved: false, solvedAt: null });
      cur.attempts = Math.max(cur.attempts, Number(r?.attempts) || 0);
      if (r?.solved) {
        cur.solved = true;
        if (r.solvedAt && (!cur.solvedAt || r.solvedAt < cur.solvedAt)) cur.solvedAt = r.solvedAt;
      }
    }
    out.deviceId = out.deviceId ?? s.deviceId ?? null;
  }
  return out;
}

function parse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function readLocal() {
  try { return parse(localStorage.getItem(KEY)); } catch { return null; }
}
function writeLocal(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

function readCookie() {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${KEY}=`));
  return hit ? parse(decodeURIComponent(hit.slice(KEY.length + 1))) : null;
}
function writeCookie(state) {
  const value = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${KEY}=${value}; max-age=${60 * 60 * 24 * 400}; path=/; SameSite=Lax`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readIdb() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function writeIdb(state) {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(state, KEY);
  } catch { /* unavailable */ }
}

export async function loadState() {
  const state = merge(readLocal(), readCookie(), await readIdb());
  state.deviceId ??= crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await saveState(state);
  return state;
}

export async function saveState(state) {
  writeLocal(state);
  writeCookie(state);
  await writeIdb(state);
}
