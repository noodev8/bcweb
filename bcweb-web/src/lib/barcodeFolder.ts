/*
=======================================================================================================================================
The FNSKU barcode folder — File System Access API, remembered between sessions
=======================================================================================================================================
The barcode images live in a Google Drive folder synced onto the operator's PC. The BCWEB API runs on a VPS and cannot see it, so the
BROWSER is what reads and writes that folder. Chrome hands us a real directory handle once the operator picks it, and the handle can be
stored in IndexedDB (uniquely among web objects — it does not survive JSON, so localStorage is no use here) and re-used forever after.

Two things about the permission model that shape the UI:

  1. The stored handle survives a browser restart but its PERMISSION does not. Each session the first access needs a one-click
     re-grant, and requestPermission() only works inside a user gesture — so it must hang off a button, never fire on mount.
  2. Read and write are separate grants. We ask for readwrite up front: the operator picks the folder once and both checking and
     generating work, rather than being interrupted by a second prompt at the moment they hit Generate.

This is Chrome/Edge only. Firefox and Safari have no File System Access API, so `folderApiAvailable()` gates the whole panel — an
internal tool on known machines, so that is a stated limitation rather than a problem to engineer around.
=======================================================================================================================================
*/

const DB_NAME = 'bcweb';
const STORE = 'handles';
const KEY = 'fnskuBarcodeFolder';

/** Chrome-only APIs, absent from lib.dom in the TS version we build against. Narrow declarations rather than `any` everywhere. */
type PermissionState = 'granted' | 'denied' | 'prompt';
interface DirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  values?(): AsyncIterableIterator<{ kind: string; name: string }>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirectoryHandle>;
};

export function folderApiAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

// --- IndexedDB, hand-rolled ------------------------------------------------------------------------------------------------------
// One key in one store. A wrapper library would be more code than this is.

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// --- The folder ------------------------------------------------------------------------------------------------------------------

/** The remembered folder, if there is one. Says nothing about whether we currently have permission to read it — check separately. */
export async function savedBarcodeFolder(): Promise<DirectoryHandle | null> {
  if (!folderApiAvailable()) return null;
  try {
    return await idbGet<DirectoryHandle>(KEY);
  } catch {
    return null; // a browser with IndexedDB blocked shouldn't take the whole panel down — it just won't remember the folder
  }
}

/** Ask the operator to pick the folder, and remember it. Must be called from a click. Returns null if they cancel the picker. */
export async function chooseBarcodeFolder(): Promise<DirectoryHandle | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('This browser cannot open folders — use Chrome or Edge');
  try {
    const handle = await picker({ id: 'fnsku-barcodes', mode: 'readwrite', startIn: 'documents' });
    await idbSet(KEY, handle);
    return handle;
  } catch (err) {
    // The picker throws AbortError when the operator hits Cancel. That is not a failure worth reporting.
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Do we have live permission on this handle — asking for it if not?
 * `prompt: false` only queries, for deciding what the button should say without popping a dialog outside a user gesture.
 */
export async function ensureFolderPermission(handle: DirectoryHandle, prompt = true): Promise<boolean> {
  if (!handle.queryPermission) return true; // no permission API implies nothing to grant
  const mode = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(mode)) === 'granted') return true;
  if (!prompt || !handle.requestPermission) return false;
  return (await handle.requestPermission(mode)) === 'granted';
}

/**
 * Every barcode already in the folder, as a set of UPPERCASE FNSKUs (filename minus the .bmp).
 *
 * Upper-cased because the diff must not depend on how a file happened to be named — Windows filenames are case-insensitive, so
 * "x000q6arld.bmp" is the same file as "X000Q6ARLD.bmp" and would otherwise read as missing and be regenerated forever.
 * Non-.bmp entries and sub-folders are ignored; Drive drops its own junk in these folders.
 */
export async function listExistingBarcodes(handle: DirectoryHandle): Promise<Set<string>> {
  const found = new Set<string>();
  if (!handle.values) return found;
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') continue;
    const match = /^(.+)\.bmp$/i.exec(entry.name);
    if (match) found.add(match[1].toUpperCase());
  }
  return found;
}

/** Write one barcode into the folder, replacing any file of the same name. */
export async function writeBarcode(handle: DirectoryHandle, fnsku: string, data: Blob): Promise<void> {
  const file = await handle.getFileHandle(`${fnsku}.bmp`, { create: true });
  const stream = await file.createWritable();
  await stream.write(data);
  await stream.close();
}
