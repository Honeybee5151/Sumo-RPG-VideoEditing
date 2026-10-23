import { BoundingBox } from '@/types/editor';

const TRACK_W = 240;
const TRACK_H = 135;
const HALF_PATCH = 8; // 17x17 patch on 240x135 grid (~7% x 12% of frame)
const PATCH_DIM = HALF_PATCH * 2 + 1;

interface TrackedObjectState {
  editId: string;
  initCx: number;
  initCy: number;
  initWidth: number;
  initHeight: number;
  capturedAtStart: boolean;
  initPatch: Float32Array;
  adaptivePatch: Float32Array;
  weights: Float32Array;
  currCx: number;
  currCy: number;
  smoothCx: number;
  smoothCy: number;
  velX: number;
  velY: number;
  lastTime: number;
}

const trackerStore = new Map<string, TrackedObjectState>();
let sharedTrackCanvas: HTMLCanvasElement | null = null;
let sharedTrackCtx: CanvasRenderingContext2D | null = null;

function getTrackContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!sharedTrackCanvas) {
    sharedTrackCanvas = document.createElement('canvas');
    sharedTrackCanvas.width = TRACK_W;
    sharedTrackCanvas.height = TRACK_H;
    sharedTrackCtx = sharedTrackCanvas.getContext('2d', {
      willReadFrequently: true,
    });
  }
  return sharedTrackCtx;
}

function buildCenterWeights(): Float32Array {
  const w = new Float32Array(PATCH_DIM * PATCH_DIM);
  let sum = 0;
  for (let py = -HALF_PATCH; py <= HALF_PATCH; py++) {
    for (let px = -HALF_PATCH; px <= HALF_PATCH; px++) {
      const dist2 = (px * px + py * py) / (HALF_PATCH * HALF_PATCH);
      // Gaussian center weight so the Dot/Box center object dominates over background edges
      const val = Math.exp(-dist2 * 2.2);
      const idx = (py + HALF_PATCH) * PATCH_DIM + (px + HALF_PATCH);
      w[idx] = val;
      sum += val;
    }
  }
  for (let i = 0; i < w.length; i++) {
    w[i] /= sum;
  }
  return w;
}

const DEFAULT_WEIGHTS = buildCenterWeights();

function extractPatch(
  imgData: Uint8ClampedArray,
  centerX: number,
  centerY: number,
  out: Float32Array
) {
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  let ptr = 0;
  for (let py = -HALF_PATCH; py <= HALF_PATCH; py++) {
    const y = Math.min(TRACK_H - 1, Math.max(0, cy + py));
    for (let px = -HALF_PATCH; px <= HALF_PATCH; px++) {
      const x = Math.min(TRACK_W - 1, Math.max(0, cx + px));
      const i = (y * TRACK_W + x) * 4;
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      // Horizontal & vertical gradient magnitude for shape/edge locking
      const xr = Math.min(TRACK_W - 1, x + 1);
      const xl = Math.max(0, x - 1);
      const yr = Math.min(TRACK_H - 1, y + 1);
      const yl = Math.max(0, y - 1);
      const gx =
        Math.abs(imgData[(y * TRACK_W + xr) * 4 + 1] - imgData[(y * TRACK_W + xl) * 4 + 1]);
      const gy =
        Math.abs(imgData[(yr * TRACK_W + x) * 4 + 1] - imgData[(yl * TRACK_W + x) * 4 + 1]);

      out[ptr++] = r;
      out[ptr++] = g;
      out[ptr++] = b;
      out[ptr++] = (gx + gy) * 0.75;
    }
  }
}

function evaluateCandidate(
  imgData: Uint8ClampedArray,
  candX: number,
  candY: number,
  initPatch: Float32Array,
  adaptivePatch: Float32Array,
  weights: Float32Array,
  predX: number,
  predY: number
): number {
  let score = 0;
  let wIdx = 0;
  let pIdx = 0;

  for (let py = -HALF_PATCH; py <= HALF_PATCH; py++) {
    const y = candY + py;
    const rowOffset = y * TRACK_W;
    for (let px = -HALF_PATCH; px <= HALF_PATCH; px++) {
      const x = candX + px;
      const i = (rowOffset + x) * 4;
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];

      const xr = x + 1 < TRACK_W ? x + 1 : x;
      const xl = x - 1 >= 0 ? x - 1 : x;
      const yr = y + 1 < TRACK_H ? y + 1 : y;
      const yl = y - 1 >= 0 ? y - 1 : y;
      const grad =
        (Math.abs(imgData[(rowOffset + xr) * 4 + 1] - imgData[(rowOffset + xl) * 4 + 1]) +
          Math.abs(imgData[(yr * TRACK_W + x) * 4 + 1] - imgData[(yl * TRACK_W + x) * 4 + 1])) *
        0.75;

      const tr = initPatch[pIdx] * 0.65 + adaptivePatch[pIdx] * 0.35;
      const tg = initPatch[pIdx + 1] * 0.65 + adaptivePatch[pIdx + 1] * 0.35;
      const tb = initPatch[pIdx + 2] * 0.65 + adaptivePatch[pIdx + 2] * 0.35;
      const tGrad = initPatch[pIdx + 3] * 0.65 + adaptivePatch[pIdx + 3] * 0.35;

      const diff =
        Math.abs(r - tr) +
        Math.abs(g - tg) +
        Math.abs(b - tb) +
        Math.abs(grad - tGrad) * 1.3;

      score += diff * weights[wIdx];
      wIdx++;
      pIdx += 4;
    }
  }

  // Gentle motion continuity regularization so uniform backgrounds don't cause jumps
  const distPenalty =
    Math.hypot(candX - predX, candY - predY) * 0.32;
  return score + distPenalty;
}

/**
 * Tracks the target bounding box / dot across frames of `sourceCanvas` in real time.
 * Returns the live tracked BoundingBox in normalized 0..1 coordinates.
 */
export function getRealtimeTrackedBbox(
  editId: string,
  sourceCanvas: HTMLCanvasElement,
  initialBbox: BoundingBox,
  currentTime: number,
  startTime: number
): BoundingBox {
  const ctx = getTrackContext();
  if (!ctx) return initialBbox;

  ctx.drawImage(sourceCanvas, 0, 0, TRACK_W, TRACK_H);
  const imgData = ctx.getImageData(0, 0, TRACK_W, TRACK_H).data;

  const isNearStart = Math.abs(currentTime - startTime) <= 0.18;
  let state = trackerStore.get(editId);

  const bboxMovedByUser =
    state &&
    (Math.abs(state.initCx - initialBbox.cx) > 0.005 ||
      Math.abs(state.initCy - initialBbox.cy) > 0.005);

  const loopedBack =
    state &&
    (currentTime < state.lastTime - 0.15 ||
      (isNearStart && !state.capturedAtStart));

  if (!state || bboxMovedByUser || loopedBack) {
    const startPx = Math.min(
      TRACK_W - HALF_PATCH - 2,
      Math.max(HALF_PATCH + 2, Math.round(initialBbox.cx * TRACK_W))
    );
    const startPy = Math.min(
      TRACK_H - HALF_PATCH - 2,
      Math.max(HALF_PATCH + 2, Math.round(initialBbox.cy * TRACK_H))
    );

    const initPatch = new Float32Array(PATCH_DIM * PATCH_DIM * 4);
    extractPatch(imgData, startPx, startPy, initPatch);
    const adaptivePatch = new Float32Array(initPatch);

    state = {
      editId,
      initCx: initialBbox.cx,
      initCy: initialBbox.cy,
      initWidth: initialBbox.width,
      initHeight: initialBbox.height,
      capturedAtStart: isNearStart,
      initPatch,
      adaptivePatch,
      weights: DEFAULT_WEIGHTS,
      currCx: initialBbox.cx,
      currCy: initialBbox.cy,
      smoothCx: initialBbox.cx,
      smoothCy: initialBbox.cy,
      velX: 0,
      velY: 0,
      lastTime: currentTime,
    };
    trackerStore.set(editId, state);
    return initialBbox;
  }

  const dt = currentTime - state.lastTime;
  if (Math.abs(dt) < 0.004) {
    return {
      x: Math.min(1 - initialBbox.width, Math.max(0, state.smoothCx - initialBbox.width / 2)),
      y: Math.min(1 - initialBbox.height, Math.max(0, state.smoothCy - initialBbox.height / 2)),
      width: initialBbox.width,
      height: initialBbox.height,
      cx: state.smoothCx,
      cy: state.smoothCy,
    };
  }

  const clampedDt = Math.min(0.2, Math.max(0.008, dt));
  const curPx = state.currCx * TRACK_W;
  const curPy = state.currCy * TRACK_H;
  const predPx = Math.min(
    TRACK_W - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, curPx + state.velX * clampedDt * TRACK_W * 0.55)
  );
  const predPy = Math.min(
    TRACK_H - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, curPy + state.velY * clampedDt * TRACK_H * 0.55)
  );

  // Stage 1: Coarse search around predicted position
  const searchRx = 34;
  const searchRy = 24;
  let bestX = Math.round(predPx);
  let bestY = Math.round(predPy);
  let bestScore = Number.POSITIVE_INFINITY;

  const minX = Math.max(HALF_PATCH + 1, Math.round(predPx) - searchRx);
  const maxX = Math.min(TRACK_W - HALF_PATCH - 2, Math.round(predPx) + searchRx);
  const minY = Math.max(HALF_PATCH + 1, Math.round(predPy) - searchRy);
  const maxY = Math.min(TRACK_H - HALF_PATCH - 2, Math.round(predPy) + searchRy);

  for (let cy = minY; cy <= maxY; cy += 2) {
    for (let cx = minX; cx <= maxX; cx += 2) {
      const s = evaluateCandidate(
        imgData,
        cx,
        cy,
        state.initPatch,
        state.adaptivePatch,
        state.weights,
        predPx,
        predPy
      );
      if (s < bestScore) {
        bestScore = s;
        bestX = cx;
        bestY = cy;
      }
    }
  }

  // Stage 2: If fast motion exceeded local window, run wide recovery search
  if (bestScore > 75) {
    const wideRx = 72;
    const wideRy = 45;
    const wMinX = Math.max(HALF_PATCH + 1, Math.round(curPx) - wideRx);
    const wMaxX = Math.min(TRACK_W - HALF_PATCH - 2, Math.round(curPx) + wideRx);
    const wMinY = Math.max(HALF_PATCH + 1, Math.round(curPy) - wideRy);
    const wMaxY = Math.min(TRACK_H - HALF_PATCH - 2, Math.round(curPy) + wideRy);

    for (let cy = wMinY; cy <= wMaxY; cy += 3) {
      for (let cx = wMinX; cx <= wMaxX; cx += 3) {
        const s = evaluateCandidate(
          imgData,
          cx,
          cy,
          state.initPatch,
          state.adaptivePatch,
          state.weights,
          predPx,
          predPy
        );
        if (s < bestScore) {
          bestScore = s;
          bestX = cx;
          bestY = cy;
        }
      }
    }
  }

  // Stage 3: Single-pixel refinement around winner
  const refMinX = Math.max(HALF_PATCH + 1, bestX - 2);
  const refMaxX = Math.min(TRACK_W - HALF_PATCH - 2, bestX + 2);
  const refMinY = Math.max(HALF_PATCH + 1, bestY - 2);
  const refMaxY = Math.min(TRACK_H - HALF_PATCH - 2, bestY + 2);

  for (let cy = refMinY; cy <= refMaxY; cy++) {
    for (let cx = refMinX; cx <= refMaxX; cx++) {
      const s = evaluateCandidate(
        imgData,
        cx,
        cy,
        state.initPatch,
        state.adaptivePatch,
        state.weights,
        predPx,
        predPy
      );
      if (s < bestScore) {
        bestScore = s;
        bestX = cx;
        bestY = cy;
      }
    }
  }

  // Gently blend matched patch into adaptivePatch so slight object rotation/scale is tracked
  if (bestScore < 95) {
    const currentPatch = new Float32Array(PATCH_DIM * PATCH_DIM * 4);
    extractPatch(imgData, bestX, bestY, currentPatch);
    for (let i = 0; i < state.adaptivePatch.length; i++) {
      state.adaptivePatch[i] =
        state.adaptivePatch[i] * 0.82 + currentPatch[i] * 0.18;
    }
  }

  const nextCx = bestX / TRACK_W;
  const nextCy = bestY / TRACK_H;

  const instVelX = (nextCx - state.currCx) / clampedDt;
  const instVelY = (nextCy - state.currCy) / clampedDt;
  state.velX = state.velX * 0.5 + instVelX * 0.5;
  state.velY = state.velY * 0.5 + instVelY * 0.5;

  state.currCx = nextCx;
  state.currCy = nextCy;

  // Smooth camera follow filter
  const smoothAlpha = Math.min(1, clampedDt * 15);
  state.smoothCx += (nextCx - state.smoothCx) * smoothAlpha;
  state.smoothCy += (nextCy - state.smoothCy) * smoothAlpha;
  state.lastTime = currentTime;

  return {
    x: Math.min(
      1 - initialBbox.width,
      Math.max(0, state.smoothCx - initialBbox.width / 2)
    ),
    y: Math.min(
      1 - initialBbox.height,
      Math.max(0, state.smoothCy - initialBbox.height / 2)
    ),
    width: initialBbox.width,
    height: initialBbox.height,
    cx: state.smoothCx,
    cy: state.smoothCy,
  };
}
