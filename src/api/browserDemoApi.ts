import type { BeaconApi } from './beaconApi';
import { ApiError, type Note, type NoteSummary } from './types';
import { validateNote } from '../lib/validation';

// Strictly for the explicit Vite browser-demo mode. Native builds use createTauriApi
// and never silently substitute this storage when Tauri IPC fails.
const DATABASE = 'beacon-browser-demo-v1';
const STORE = 'notes';

interface StoredNote {
  id: number;
  title: string;
  body: string;
  createdAt: string;
}

function unavailable(): ApiError {
  return new ApiError('unavailable', 'Browser IndexedDB storage is not available.');
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(unavailable());

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      reject(unavailable());
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onerror = () => reject(unavailable());
    request.onblocked = () =>
      reject(new ApiError('unavailable', 'Close other BEACON demo tabs and reload.'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      db.close();
      reject(unavailable());
    };
    try {
      const tx = db.transaction(STORE, mode);
      tx.onerror = fail;
      tx.onabort = fail;
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(result);
      };
      const request = operation(tx.objectStore(STORE));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = fail;
    } catch {
      fail();
    }
  });
}

/**
 * Browser-only adapter. IndexedDB is local to this browser origin and is not
 * SQLite, a native Tauri command, a backup mechanism, or an encrypted vault.
 */
export function createBrowserDemoApi(): BeaconApi {
  return {
    async getAppInfo() {
      const db = await openDatabase();
      db.close();
      return {
        appVersion: '0.1.0-browser-demo',
        dataDir: 'Browser IndexedDB: ' + DATABASE + ' (current browser only)',
        schemaVersion: 1,
        databaseError: null,
      };
    },
    async listNotes(): Promise<NoteSummary[]> {
      const notes = await transaction<StoredNote[]>('readonly', (store) => store.getAll());
      return notes
        .sort((a, b) => b.id - a.id)
        .slice(0, 1000)
        .map(({ id, title, createdAt }) => ({ id, title, createdAt }));
    },
    async getNote(id: number): Promise<Note> {
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ApiError('validation', 'Invalid note ID.');
      }
      const note = await transaction<StoredNote | undefined>('readonly', (store) => store.get(id));
      if (!note) throw new ApiError('not_found', 'That note could not be found.');
      return note;
    },
    async createNote({ title, body }): Promise<Note> {
      const errors = validateNote(title, body);
      if (errors.title || errors.body) {
        throw new ApiError('validation', errors.title ?? errors.body ?? 'Invalid note.');
      }
      const created = { title: title.trim(), body, createdAt: new Date().toISOString() };
      const id = await transaction<IDBValidKey>('readwrite', (store) => store.add(created));
      return { id: Number(id), ...created };
    },
  };
}
