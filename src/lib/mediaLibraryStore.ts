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
  renderCode?: string;
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
  renderCode?: string;
  isFavorite?: boolean;
  inCurrentProject?: boolean;
  createdAt: number;
}

export const PAPERMAN_DANCE_RENDER_CODE = `
ctx.clearRect(0, 0, width, height);
const s = width / 960;
const beat = t * 5.2;
const bounce = Math.abs(Math.sin(beat)) * 26 * s;
const sway = Math.sin(beat * 0.5) * 44 * s;
const spinStep = Math.sin(beat * 0.25);
const baseCx = width * 0.5 + sway;
const baseCy = height * 0.54 - bounce;

ctx.save();
// Ground rhythm shadow (semi-transparent oval so it overlays cleanly on any video)
const shadowScale = 1 - (bounce / (42 * s)) * 0.35;
ctx.fillStyle = 'rgba(15, 23, 42, 0.28)';
ctx.beginPath();
ctx.ellipse(baseCx, height * 0.81, 78 * s * shadowScale, 16 * s * shadowScale, 0, 0, Math.PI * 2);
ctx.fill();

// Floating origami paper stars & musical sparkles around the dancer
for (let i = 0; i < 10; i++) {
  const phase = (t * 0.85 + i * 0.37) % 1;
  const ang = i * 0.628 + Math.sin(t * 2 + i) * 0.35;
  const rad = (95 + phase * 145) * s;
  const px = baseCx + Math.cos(ang) * rad;
  const py = baseCy - 20 * s + Math.sin(ang) * rad * 0.65 - phase * 55 * s;
  const alpha = Math.sin(phase * Math.PI) * 0.85;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(t * 2.4 + i);
  ctx.fillStyle = i % 2 === 0 ? \`rgba(253, 224, 71, \${alpha})\` : \`rgba(248, 250, 252, \${alpha})\`;
  ctx.beginPath();
  const sr = (7 + (i % 3) * 3) * s;
  ctx.moveTo(0, -sr);
  ctx.lineTo(sr * 0.7, 0);
  ctx.lineTo(0, sr);
  ctx.lineTo(-sr * 0.7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

ctx.translate(baseCx, baseCy);
ctx.rotate(Math.sin(beat * 0.5) * 0.14);

const drawPaperLimb = (x1, y1, x2, y2, w1, w2, tone) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.lineTo(x2 - nx * w2, y2 - ny * w2);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.closePath();
  ctx.fillStyle = tone;
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2 * s;
  ctx.stroke();
  // Origami center crease line
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.38)';
  ctx.lineWidth = 1.3 * s;
  ctx.stroke();
  ctx.restore();
};

// Articulated dancing legs (hip -> knee -> foot)
const hipY = 48 * s;
const lHipX = -20 * s;
const rHipX = 20 * s;
const lKneeAng = Math.sin(beat) * 0.65 - 0.15;
const rKneeAng = -Math.sin(beat) * 0.65 + 0.15;
const lKneeX = lHipX + Math.sin(lKneeAng) * 56 * s;
const lKneeY = hipY + Math.cos(lKneeAng) * 56 * s;
const rKneeX = rHipX + Math.sin(rKneeAng) * 56 * s;
const rKneeY = hipY + Math.cos(rKneeAng) * 56 * s;

const lFootAng = lKneeAng + Math.cos(beat) * 0.45;
const rFootAng = rKneeAng - Math.cos(beat) * 0.45;
const lFootX = lKneeX + Math.sin(lFootAng) * 54 * s;
const lFootY = lKneeY + Math.cos(lFootAng) * 54 * s;
const rFootX = rKneeX + Math.sin(rFootAng) * 54 * s;
const rFootY = rKneeY + Math.cos(rFootAng) * 54 * s;

drawPaperLimb(lHipX, hipY, lKneeX, lKneeY, 13 * s, 10 * s, '#e2e8f0');
drawPaperLimb(lKneeX, lKneeY, lFootX, lFootY, 10 * s, 7 * s, '#f8fafc');
drawPaperLimb(rHipX, hipY, rKneeX, rKneeY, 13 * s, 10 * s, '#cbd5e1');
drawPaperLimb(rKneeX, rKneeY, rFootX, rFootY, 10 * s, 7 * s, '#f1f5f9');

// Origami paper shoes
const drawShoe = (fx, fy, dir) => {
  ctx.save();
  ctx.translate(fx, fy);
  ctx.rotate(dir * 0.25 + Math.sin(beat) * 0.2);
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(-10 * s, -6 * s);
  ctx.lineTo(22 * s * dir, 2 * s);
  ctx.lineTo(14 * s * dir, 11 * s);
  ctx.lineTo(-12 * s, 9 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};
drawShoe(lFootX, lFootY, -1);
drawShoe(rFootX, rFootY, 1);

// Articulated dancing arms (shoulder -> elbow -> hand)
const shY = -42 * s;
const lShX = -42 * s;
const rShX = 42 * s;
const lArmAng = -1.15 + Math.sin(beat) * 0.85;
const rArmAng = 1.15 + Math.sin(beat + Math.PI * 0.35) * 0.85;
const lElbX = lShX + Math.cos(lArmAng) * 54 * s;
const lElbY = shY + Math.sin(lArmAng) * 54 * s;
const rElbX = rShX + Math.cos(rArmAng) * 54 * s;
const rElbY = shY + Math.sin(rArmAng) * 54 * s;

const lHandAng = lArmAng - 0.7 + Math.cos(beat) * 0.55;
const rHandAng = rArmAng + 0.7 - Math.cos(beat) * 0.55;
const lHandX = lElbX + Math.cos(lHandAng) * 48 * s;
const lHandY = lElbY + Math.sin(lHandAng) * 48 * s;
const rHandX = rElbX + Math.cos(rHandAng) * 48 * s;
const rHandY = rElbY + Math.sin(rHandAng) * 48 * s;

drawPaperLimb(lShX, shY, lElbX, lElbY, 11 * s, 8.5 * s, '#e2e8f0');
drawPaperLimb(lElbX, lElbY, lHandX, lHandY, 8.5 * s, 6.5 * s, '#ffffff');
drawPaperLimb(rShX, shY, rElbX, rElbY, 11 * s, 8.5 * s, '#cbd5e1');
drawPaperLimb(rElbX, rElbY, rHandX, rHandY, 8.5 * s, 6.5 * s, '#f8fafc');

// Origami faceted torso (left & right paper fold panels)
ctx.save();
ctx.beginPath();
ctx.moveTo(0, -56 * s);
ctx.lineTo(48 * s, -44 * s);
ctx.lineTo(28 * s, 52 * s);
ctx.lineTo(0, 58 * s);
ctx.closePath();
ctx.fillStyle = '#e2e8f0';
ctx.fill();
ctx.strokeStyle = '#475569';
ctx.lineWidth = 2.2 * s;
ctx.stroke();

ctx.beginPath();
ctx.moveTo(0, -56 * s);
ctx.lineTo(-48 * s, -44 * s);
ctx.lineTo(-28 * s, 52 * s);
ctx.lineTo(0, 58 * s);
ctx.closePath();
ctx.fillStyle = '#ffffff';
ctx.fill();
ctx.stroke();

// Red origami bow-tie at collar
ctx.fillStyle = '#ef4444';
ctx.beginPath();
ctx.moveTo(0, -48 * s);
ctx.lineTo(-16 * s, -56 * s);
ctx.lineTo(-14 * s, -40 * s);
ctx.closePath();
ctx.moveTo(0, -48 * s);
ctx.lineTo(16 * s, -56 * s);
ctx.lineTo(14 * s, -40 * s);
ctx.closePath();
ctx.fill();
ctx.restore();

// Origami faceted head & paper boat hat
ctx.save();
ctx.translate(0, -96 * s);
ctx.rotate(Math.sin(beat * 0.5 + 0.6) * 0.18 + spinStep * 0.08);

ctx.beginPath();
ctx.moveTo(0, -42 * s);
ctx.lineTo(38 * s, -12 * s);
ctx.lineTo(28 * s, 34 * s);
ctx.lineTo(0, 42 * s);
ctx.lineTo(-28 * s, 34 * s);
ctx.lineTo(-38 * s, -12 * s);
ctx.closePath();
ctx.fillStyle = '#fffdf9';
ctx.fill();
ctx.strokeStyle = '#334155';
ctx.lineWidth = 2.4 * s;
ctx.stroke();

// Right cheek paper fold shadow
ctx.beginPath();
ctx.moveTo(0, -42 * s);
ctx.lineTo(38 * s, -12 * s);
ctx.lineTo(28 * s, 34 * s);
ctx.lineTo(0, 42 * s);
ctx.closePath();
ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
ctx.fill();

// Drawn charcoal eyes & joyful grin
ctx.fillStyle = '#1e293b';
ctx.beginPath();
ctx.arc(-13 * s, -4 * s, 4.2 * s, 0, Math.PI * 2);
ctx.arc(13 * s, -4 * s, 4.2 * s, 0, Math.PI * 2);
ctx.fill();

ctx.strokeStyle = '#1e293b';
ctx.lineWidth = 2.6 * s;
ctx.lineCap = 'round';
ctx.beginPath();
ctx.arc(0, 6 * s, 14 * s, 0.15 * Math.PI, 0.85 * Math.PI);
ctx.stroke();

// Classic folded origami paper boat hat on top
ctx.beginPath();
ctx.moveTo(-44 * s, -22 * s);
ctx.lineTo(0, -64 * s);
ctx.lineTo(44 * s, -22 * s);
ctx.closePath();
ctx.fillStyle = '#f59e0b';
ctx.fill();
ctx.strokeStyle = '#78350f';
ctx.lineWidth = 2 * s;
ctx.stroke();

ctx.beginPath();
ctx.moveTo(-48 * s, -20 * s);
ctx.lineTo(48 * s, -20 * s);
ctx.lineTo(34 * s, -34 * s);
ctx.lineTo(-34 * s, -34 * s);
ctx.closePath();
ctx.fillStyle = '#fbbf24';
ctx.fill();
ctx.stroke();

ctx.restore();
ctx.restore();
`.trim();

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
        const items: MediaAssetItem[] = records.map((rec) => {
          const isLegacyPaperman =
            rec.category === 'video' &&
            !rec.renderCode &&
            /paperman\s*dance/i.test(rec.name);
          return {
            id: rec.id,
            name: rec.name,
            category: rec.category,
            url: URL.createObjectURL(rec.blob),
            blob: rec.blob,
            durationSec:
              rec.durationSec && Number.isFinite(rec.durationSec) && rec.durationSec > 0
                ? rec.durationSec
                : isLegacyPaperman
                ? 5
                : undefined,
            renderCode:
              rec.renderCode || (isLegacyPaperman ? PAPERMAN_DANCE_RENDER_CODE : undefined),
            isFavorite: true,
            inCurrentProject: Boolean(rec.inCurrentProject),
            createdAt: rec.createdAt,
          };
        });
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
      const isLegacyPaperman =
        rec.category === 'video' &&
        !rec.renderCode &&
        /paperman\s*dance/i.test(rec.name);
      items.push({
        id: rec.id,
        name: rec.name,
        category: rec.category,
        url: URL.createObjectURL(rec.blob),
        blob: rec.blob,
        durationSec:
          rec.durationSec && Number.isFinite(rec.durationSec) && rec.durationSec > 0
            ? rec.durationSec
            : isLegacyPaperman
            ? 5
            : undefined,
        renderCode:
          rec.renderCode || (isLegacyPaperman ? PAPERMAN_DANCE_RENDER_CODE : undefined),
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
        renderCode: item.renderCode,
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
