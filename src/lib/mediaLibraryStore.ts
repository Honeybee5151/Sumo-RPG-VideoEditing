export type MediaCategory = 'video' | 'image' | 'audio';

export interface MediaAssetItem {
  id: string;
  name: string;
  category: MediaCategory;
  url: string;
  blob?: Blob;
  isFavorite: boolean;
  inCurrentProject: boolean;
  createdAt: number;
}

const DB_NAME = 'chromacut_media_favorites_db';
const STORE_NAME = 'favorites';
const DB_VERSION = 1;

interface StoredFavoriteRecord {
  id: string;
  name: string;
  category: MediaCategory;
  blob: Blob;
  createdAt: number;
}

function openFavoritesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadPersistedFavorites(): Promise<MediaAssetItem[]> {
  try {
    const db = await openFavoritesDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = (req.result || []) as StoredFavoriteRecord[];
        const items: MediaAssetItem[] = records.map((rec) => ({
          id: rec.id,
          name: rec.name,
          category: rec.category,
          url: URL.createObjectURL(rec.blob),
          blob: rec.blob,
          isFavorite: true,
          inCurrentProject: false,
          createdAt: rec.createdAt,
        }));
        resolve(items.sort((a, b) => b.createdAt - a.createdAt));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveFavoriteToDb(item: MediaAssetItem): Promise<void> {
  if (!item.blob) return;
  try {
    const db = await openFavoritesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const rec: StoredFavoriteRecord = {
        id: item.id,
        name: item.name,
        category: item.category,
        blob: item.blob!,
        createdAt: item.createdAt,
      };
      const req = store.put(rec);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore storage quota errors
  }
}

export async function removeFavoriteFromDb(id: string): Promise<void> {
  try {
    const db = await openFavoritesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

export function detectMediaCategory(file: File): MediaCategory {
  if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name)) {
    return 'image';
  }
  if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
    return 'audio';
  }
  return 'video';
}
