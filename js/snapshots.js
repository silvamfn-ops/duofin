// js/snapshots.js — Histórico de Versões & Snapshots Automáticos em IndexedDB (v6.7.0)
const DB_NAME = 'duofin-snapshots-db';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const MAX_SNAPSHOTS = 5;

function openSnapshotsDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponível neste navegador.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        const store = idb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir IndexedDB.'));
  });
}

export async function createAutoSnapshot(dbState, reason = 'Cópia automática') {
  try {
    if (!dbState || !dbState.settings || !Array.isArray(dbState.transactions)) return null;
    const idb = await openSnapshotsDb();
    const txCount = dbState.transactions.length;
    const goalCount = Array.isArray(dbState.savingsGoals) ? dbState.savingsGoals.length : 0;
    const payloadCopy = JSON.parse(JSON.stringify(dbState));

    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getAllReq = store.getAll();

      getAllReq.onsuccess = () => {
        const all = (getAllReq.result || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const last = all[all.length - 1];
        if (last && last.reason === reason && (Date.now() - last.createdAt) < 10000 && last.txCount === txCount) {
          resolve(last);
          return;
        }
        while (all.length >= MAX_SNAPSHOTS) {
          const oldest = all.shift();
          if (oldest && oldest.id != null) store.delete(oldest.id);
        }
        const entry = {
          createdAt: Date.now(),
          reason,
          txCount,
          goalCount,
          data: payloadCopy
        };
        const addReq = store.add(entry);
        addReq.onsuccess = () => {
          entry.id = addReq.result;
          resolve(entry);
        };
        addReq.onerror = () => reject(addReq.error);
      };
      getAllReq.onerror = () => reject(getAllReq.error);
    });
  } catch (e) {
    console.warn('[DuoFin Snapshots] Falha ao guardar snapshot:', e);
    return null;
  }
}

export async function listSnapshots() {
  try {
    const idb = await openSnapshotsDb();
    return await new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return [];
  }
}

export async function getSnapshotById(id) {
  const idb = await openSnapshotsDb();
  return await new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(Number(id));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllSnapshots() {
  const idb = await openSnapshotsDb();
  return await new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

