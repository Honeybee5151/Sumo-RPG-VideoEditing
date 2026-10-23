import {
  BuiltInSceneId,
  DrawingTool,
  MarkColor,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';

export type MediaCategory = 'video' | 'image' | 'audio';

export interface MediaAssetItem {
  id: string;
  name: string;
  category: MediaCategory;
  url: string;
  blob?: Blob;
  durationSec?: number;
  isFavorite: boolean;
  inCurrentProject: boolean;
  createdAt: number;
}

export interface AssetTimelineState {
  annotations: ScreenAnnotation[];
  edits: TimelineEditItem[];
  cuts: Array<{ id: string; startTime: number; endTime: number }>;
  splitPoints: number[];
  duration: number;
  currentTime: number;
  intervalStart: number;
  intervalEnd: number;
  focusedColor: MarkColor | 'all';
  activeColor: MarkColor;
  colorPrompts: Partial<Record<MarkColor, string>>;
  imageHasAiTime: boolean;
}

export interface PersistedProjectSession {
  version: number;
  savedAt: number;
  sceneId: BuiltInSceneId;
  activeVideoAssetId: string | null;
  activeImageAssetId: string | null;
  activeAudioAssetId: string | null;
  videoFileName: string;
  duration: number;
  currentTime: number;
  intervalStart: number;
  intervalEnd: number;
  annotations: ScreenAnnotation[];
  edits: TimelineEditItem[];
  cuts: Array<{ id: string; startTime: number; endTime: number }>;
  splitPoints: number[];
  focusedColor: MarkColor | 'all';
  activeColor: MarkColor;
  activeTool: DrawingTool;
  imageHasAiTime: boolean;
  loopIntervalOnly: boolean;
  isMuted: boolean;
  timelineZoom: number;
  timelineScrollStart: number;
  libraryScope: 'project' | 'favorites';
  libraryCategory: MediaCategory;
  prompt: string;
  colorPrompts: Partial<Record<MarkColor, string>>;
  waveformPeaks: number[];
  assetTimelines?: Record<string, AssetTimelineState>;
}

const DB_NAME = 'chromacut_media_favorites_db';
const STORE_NAME = 'favorites';
const PROJECT_ASSETS_STORE = 'project_assets';
const SESSION_STORE = 'project_session';
const DB_VERSION = 2;
const LOCAL_STORAGE_SESSION_KEY = 'sumo_autosave_project_session_v1';

interface StoredFavoriteRecord {
  id: string;
  name: string;
  category: MediaCategory;
  blob: Blob;
  durationSec?: number;
  isFavorite?: boolean;
  inCurrentProject?: boolean;
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
      if (!db.objectStoreNames.contains(PROJECT_ASSETS_STORE)) {
        db.createObjectStore(PROJECT_ASSETS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
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
          inCurrentProject: Boolean(rec.inCurrentProject),
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

export async function loadAllPersistedMediaAssets(): Promise<MediaAssetItem[]> {
  try {
    const db = await openFavoritesDb();
    const [favRecords, projRecords] = await Promise.all([
      new Promise<StoredFavoriteRecord[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve((req.result || []) as StoredFavoriteRecord[]);
        req.onerror = () => resolve([]);
      }),
      new Promise<StoredFavoriteRecord[]>((resolve) => {
        const tx = db.transaction(PROJECT_ASSETS_STORE, 'readonly');
        const req = tx.objectStore(PROJECT_ASSETS_STORE).getAll();
        req.onsuccess = () => resolve((req.result || []) as StoredFavoriteRecord[]);
        req.onerror = () => resolve([]);
      }),
    ]);

    const mergedMap = new Map<string, StoredFavoriteRecord>();
    for (const r of favRecords) {
      mergedMap.set(r.id, {
        ...r,
        isFavorite: true,
        inCurrentProject: Boolean(r.inCurrentProject),
      });
    }
    for (const r of projRecords) {
      const existing = mergedMap.get(r.id);
      mergedMap.set(r.id, {
        ...r,
        isFavorite: Boolean(r.isFavorite || existing?.isFavorite),
        inCurrentProject:
          r.inCurrentProject !== undefined ? r.inCurrentProject : true,
      });
    }

    const items: MediaAssetItem[] = [];
    for (const rec of mergedMap.values()) {
      if (!rec.blob) continue;
      items.push({
        id: rec.id,
        name: rec.name,
        category: rec.category,
        url: URL.createObjectURL(rec.blob),
        blob: rec.blob,
        durationSec: rec.durationSec,
        isFavorite: Boolean(rec.isFavorite),
        inCurrentProject: Boolean(rec.inCurrentProject),
        createdAt: rec.createdAt,
      });
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveMediaAssetToDb(item: MediaAssetItem): Promise<void> {
  if (!item.blob) return;
  try {
    const db = await openFavoritesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECT_ASSETS_STORE, STORE_NAME], 'readwrite');
      const rec: StoredFavoriteRecord = {
        id: item.id,
        name: item.name,
        category: item.category,
        blob: item.blob!,
        durationSec: item.durationSec,
        isFavorite: item.isFavorite,
        inCurrentProject: item.inCurrentProject,
        createdAt: item.createdAt,
      };
      if (item.inCurrentProject || item.isFavorite) {
        tx.objectStore(PROJECT_ASSETS_STORE).put(rec);
      } else {
        tx.objectStore(PROJECT_ASSETS_STORE).delete(item.id);
      }
      if (item.isFavorite) {
        tx.objectStore(STORE_NAME).put(rec);
      } else {
        tx.objectStore(STORE_NAME).delete(item.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore storage quota errors
  }
}

export async function removeMediaAssetFromDb(id: string): Promise<void> {
  try {
    const db = await openFavoritesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([PROJECT_ASSETS_STORE, STORE_NAME], 'readwrite');
      tx.objectStore(PROJECT_ASSETS_STORE).delete(id);
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function saveProjectSessionState(
  session: PersistedProjectSession
): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        LOCAL_STORAGE_SESSION_KEY,
        JSON.stringify(session)
      );
    }
  } catch {
    // ignore localStorage quota errors
  }

  try {
    const db = await openFavoritesDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put({ id: 'latest', ...session });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore IndexedDB errors
  }
}

export async function loadProjectSessionState(): Promise<PersistedProjectSession | null> {
  let localSession: PersistedProjectSession | null = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
      if (raw) {
        localSession = JSON.parse(raw) as PersistedProjectSession;
      }
    }
  } catch {
    // ignore parse issues
  }

  try {
    const db = await openFavoritesDb();
    const idbSession = await new Promise<PersistedProjectSession | null>((resolve) => {
      const tx = db.transaction(SESSION_STORE, 'readonly');
      const req = tx.objectStore(SESSION_STORE).get('latest');
      req.onsuccess = () =>
        resolve((req.result as PersistedProjectSession | undefined) || null);
      req.onerror = () => resolve(null);
    });

    if (idbSession && localSession) {
      const newer =
        (idbSession.savedAt || 0) >= (localSession.savedAt || 0)
          ? idbSession
          : localSession;
      const older = newer === idbSession ? localSession : idbSession;
      return {
        ...newer,
        assetTimelines: {
          ...(older.assetTimelines || {}),
          ...(newer.assetTimelines || {}),
        },
      };
    }
    return idbSession || localSession;
  } catch {
    return localSession;
  }
}

export async function saveFavoriteToDb(item: MediaAssetItem): Promise<void> {
  await saveMediaAssetToDb(item);
}

export async function removeFavoriteFromDb(id: string): Promise<void> {
  if (!id) return;
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
