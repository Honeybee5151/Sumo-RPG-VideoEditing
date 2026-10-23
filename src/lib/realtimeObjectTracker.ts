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
      // Tight Gaussian center weight so the Dot/Box center object dominates over background edges
      const val = Math.exp(-dist2 * 2.6);
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
  predY: number,
  curX: number,
  curY: number
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

      const tr = initPatch[pIdx] * 0.55 + adaptivePatch[pIdx] * 0.45;
      const tg = initPatch[pIdx + 1] * 0.55 + adaptivePatch[pIdx + 1] * 0.45;
      const tb = initPatch[pIdx + 2] * 0.55 + adaptivePatch[pIdx + 2] * 0.45;
      const tGrad = initPatch[pIdx + 3] * 0.55 + adaptivePatch[pIdx + 3] * 0.45;

      const diff =
        Math.abs(r - tr) +
        Math.abs(g - tg) +
        Math.abs(b - tb) +
        Math.abs(grad - tGrad) * 1.35;

      score += diff * weights[wIdx];
      wIdx++;
      pIdx += 4;
    }
  }

  // Strong spatial continuity regularization so the tracker never teleports to distant background patches
  const dxPred = candX - predX;
  const dyPred = candY - predY;
  const dxCur = candX - curX;
  const dyCur = candY - curY;
  const distPenalty =
    Math.hypot(dxPred, dyPred) * 1.9 + (dxCur * dxCur + dyCur * dyCur) * 0.28;
  return score + distPenalty;
}

/**
 * Tracks the target bounding box / dot across frames of `sourceCanvas` in real time.
 * Uses bounded physical per-frame displacement, confidence gating, and Steadicam smoothing
 * so the camera follows the object without jumping away.
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

  const clampedDt = Math.min(0.12, Math.max(0.008, dt));
  const curPx = state.currCx * TRACK_W;
  const curPy = state.currCy * TRACK_H;
  const predPx = Math.min(
    TRACK_W - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, curPx + state.velX * clampedDt * TRACK_W * 0.45)
  );
  const predPy = Math.min(
    TRACK_H - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, curPy + state.velY * clampedDt * TRACK_H * 0.45)
  );

  // Physically bounded per-frame search radius (prevents teleporting to distant false matches)
  const searchRx = Math.max(7, Math.min(15, Math.ceil(clampedDt * TRACK_W * 1.4)));
  const searchRy = Math.max(6, Math.min(12, Math.ceil(clampedDt * TRACK_H * 1.4)));

  const stayX = Math.round(predPx);
  const stayY = Math.round(predPy);
  const stayScore = evaluateCandidate(
    imgData,
    stayX,
    stayY,
    state.initPatch,
    state.adaptivePatch,
    state.weights,
    predPx,
    predPy,
    curPx,
    curPy
  );

  let bestX = stayX;
  let bestY = stayY;
  let bestScore = stayScore;

  const minX = Math.max(HALF_PATCH + 1, stayX - searchRx);
  const maxX = Math.min(TRACK_W - HALF_PATCH - 2, stayX + searchRx);
  const minY = Math.max(HALF_PATCH + 1, stayY - searchRy);
  const maxY = Math.min(TRACK_H - HALF_PATCH - 2, stayY + searchRy);

  // Full 1-pixel precision search inside the bounded neighborhood
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const s = evaluateCandidate(
        imgData,
        cx,
        cy,
        state.initPatch,
        state.adaptivePatch,
        state.weights,
        predPx,
        predPy,
        curPx,
        curPy
      );
      if (s < bestScore) {
        bestScore = s;
        bestX = cx;
        bestY = cy;
      }
    }
  }

  // Confidence gate: only accept displacement if the match is confident and beats staying put
  const isConfidentMatch = bestScore < 82 && bestScore <= stayScore - 0.8;
  if (!isConfidentMatch && stayScore >= 82) {
    // Object briefly occluded or motion-blurred: coast gently and decay velocity
    state.velX *= 0.7;
    state.velY *= 0.7;
    bestX = Math.round(curPx + state.velX * clampedDt * TRACK_W * 0.3);
    bestY = Math.round(curPy + state.velY * clampedDt * TRACK_H * 0.3);
  } else if (bestScore < 68) {
    // High-confidence match: gently update adaptive appearance template
    const currentPatch = new Float32Array(PATCH_DIM * PATCH_DIM * 4);
    extractPatch(imgData, bestX, bestY, currentPatch);
    for (let i = 0; i < state.adaptivePatch.length; i++) {
      state.adaptivePatch[i] =
        state.adaptivePatch[i] * 0.86 + currentPatch[i] * 0.14;
    }
  }

  // Clamp per-frame step to prevent any single-frame spike
  const maxStepNormX = 0.045;
  const maxStepNormY = 0.045;
  const rawNextCx = bestX / TRACK_W;
  const rawNextCy = bestY / TRACK_H;
  const nextCx =
    state.currCx +
    Math.max(-maxStepNormX, Math.min(maxStepNormX, rawNextCx - state.currCx));
  const nextCy =
    state.currCy +
    Math.max(-maxStepNormY, Math.min(maxStepNormY, rawNextCy - state.currCy));

  const instVelX = Math.max(-0.9, Math.min(0.9, (nextCx - state.currCx) / clampedDt));
  const instVelY = Math.max(-0.9, Math.min(0.9, (nextCy - state.currCy) / clampedDt));
  state.velX = state.velX * 0.65 + instVelX * 0.35;
  state.velY = state.velY * 0.65 + instVelY * 0.35;

  state.currCx = nextCx;
  state.currCy = nextCy;

  // Steadicam low-pass filter so camera glides smoothly without sudden jumps
  const smoothAlpha = Math.min(1, clampedDt * 9.5);
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
