import { BoundingBox } from '@/types/editor';

const TRACK_W = 240;
const TRACK_H = 135;
const HALF_PATCH = 8; // 17x17 patch on 240x135 grid (~7% x 12% of frame)
const PATCH_DIM = HALF_PATCH * 2 + 1;

export interface IdentifiedObjectProfile {
  dominantColorsHex: string[];
  backgroundColorsHex: string[];
  segmentedBbox: BoundingBox;
  foregroundContrast: number;
}

interface RgbSample {
  r: number;
  g: number;
  b: number;
}

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
  objectSeeds: RgbSample[];
  bgSeeds: RgbSample[];
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

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  );
}

function minColorDist(r: number, g: number, b: number, seeds: RgbSample[]): number {
  let best = 9999;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const d = Math.abs(r - s.r) + Math.abs(g - s.g) + Math.abs(b - s.b);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Computes the likelihood [0..1] that pixel (r,g,b) belongs to the identified
 * foreground object rather than the surrounding background ring.
 */
function computeForegroundProb(
  r: number,
  g: number,
  b: number,
  objectSeeds: RgbSample[],
  bgSeeds: RgbSample[]
): number {
  if (objectSeeds.length === 0 || bgSeeds.length === 0) return 0.5;
  const dObj = minColorDist(r, g, b, objectSeeds);
  const dBg = minColorDist(r, g, b, bgSeeds);
  return Math.max(0, Math.min(1, (dBg - dObj + 24) / (dBg + dObj + 32)));
}

function extractObjectAndBgSeeds(
  imgData: Uint8ClampedArray,
  centerX: number,
  centerY: number
): {
  objectSeeds: RgbSample[];
  bgSeeds: RgbSample[];
  segmentedWeights: Float32Array;
} {
  const cx = Math.round(centerX);
  const cy = Math.round(centerY);
  const objectSeeds: RgbSample[] = [];
  const bgSeeds: RgbSample[] = [];

  // 1. Sample 5x5 core right where the user placed the Dot/Box center (the target object)
  for (let dy = -2; dy <= 2; dy++) {
    const y = Math.min(TRACK_H - 1, Math.max(0, cy + dy));
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.min(TRACK_W - 1, Math.max(0, cx + dx));
      const idx = (y * TRACK_W + x) * 4;
      objectSeeds.push({
        r: imgData[idx],
        g: imgData[idx + 1],
        b: imgData[idx + 2],
      });
    }
  }

  // 2. Sample background perimeter ring (radius 10..14 outside the object core)
  for (let angle = 0; angle < 24; angle++) {
    const rad = (angle / 24) * Math.PI * 2;
    for (const dist of [10, 13]) {
      const x = Math.min(
        TRACK_W - 1,
        Math.max(0, Math.round(cx + Math.cos(rad) * dist))
      );
      const y = Math.min(
        TRACK_H - 1,
        Math.max(0, Math.round(cy + Math.sin(rad) * dist))
      );
      const idx = (y * TRACK_W + x) * 4;
      bgSeeds.push({
        r: imgData[idx],
        g: imgData[idx + 1],
        b: imgData[idx + 2],
      });
    }
  }

  // 3. Build foreground-segmented patch weights (background pixels inside the 17x17 patch are suppressed!)
  const weights = new Float32Array(PATCH_DIM * PATCH_DIM);
  let sum = 0;
  for (let py = -HALF_PATCH; py <= HALF_PATCH; py++) {
    const y = Math.min(TRACK_H - 1, Math.max(0, cy + py));
    for (let px = -HALF_PATCH; px <= HALF_PATCH; px++) {
      const x = Math.min(TRACK_W - 1, Math.max(0, cx + px));
      const i = (y * TRACK_W + x) * 4;
      const fgP = computeForegroundProb(
        imgData[i],
        imgData[i + 1],
        imgData[i + 2],
        objectSeeds,
        bgSeeds
      );
      const dist2 = (px * px + py * py) / (HALF_PATCH * HALF_PATCH);
      const spatialWeight = Math.exp(-dist2 * 2.2);
      // Pixels that belong to the foreground object get full weight; background pixels get masked out
      const combined = spatialWeight * (0.1 + 0.9 * fgP);
      const wIdx = (py + HALF_PATCH) * PATCH_DIM + (px + HALF_PATCH);
      weights[wIdx] = combined;
      sum += combined;
    }
  }

  const normFactor = sum > 1e-5 ? 1 / sum : 1 / weights.length;
  for (let i = 0; i < weights.length; i++) {
    weights[i] *= normFactor;
  }

  return { objectSeeds, bgSeeds, segmentedWeights: weights };
}

/**
 * Identifies and segments the distinct foreground object at `bbox` on `sourceCanvas`
 * so the AI context knows the object's colors, contrast, and segmented bounds.
 */
export function identifyObjectAtBbox(
  sourceCanvas: HTMLCanvasElement,
  bbox: BoundingBox
): IdentifiedObjectProfile {
  const ctx = getTrackContext();
  if (!ctx) {
    return {
      dominantColorsHex: ['#ffffff'],
      backgroundColorsHex: ['#000000'],
      segmentedBbox: bbox,
      foregroundContrast: 1,
    };
  }

  ctx.drawImage(sourceCanvas, 0, 0, TRACK_W, TRACK_H);
  const imgData = ctx.getImageData(0, 0, TRACK_W, TRACK_H).data;
  const startPx = Math.min(
    TRACK_W - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, Math.round(bbox.cx * TRACK_W))
  );
  const startPy = Math.min(
    TRACK_H - HALF_PATCH - 2,
    Math.max(HALF_PATCH + 2, Math.round(bbox.cy * TRACK_H))
  );

  const { objectSeeds, bgSeeds } = extractObjectAndBgSeeds(
    imgData,
    startPx,
    startPy
  );

  let minX = startPx;
  let maxX = startPx;
  let minY = startPy;
  let maxY = startPy;

  for (let py = -12; py <= 12; py++) {
    const y = Math.min(TRACK_H - 1, Math.max(0, startPy + py));
    for (let px = -12; px <= 12; px++) {
      const x = Math.min(TRACK_W - 1, Math.max(0, startPx + px));
      const i = (y * TRACK_W + x) * 4;
      const fg = computeForegroundProb(
        imgData[i],
        imgData[i + 1],
        imgData[i + 2],
        objectSeeds,
        bgSeeds
      );
      if (fg > 0.58) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const segW = Math.max(0.04, (maxX - minX + 4) / TRACK_W);
  const segH = Math.max(0.06, (maxY - minY + 4) / TRACK_H);
  const segCx = ((minX + maxX) * 0.5) / TRACK_W;
  const segCy = ((minY + maxY) * 0.5) / TRACK_H;

  const objHex = Array.from(
    new Set(
      objectSeeds
        .filter((_, idx) => idx % 4 === 0)
        .map((c) => rgbToHex(c.r, c.g, c.b))
    )
  ).slice(0, 4);
  const bgHex = Array.from(
    new Set(
      bgSeeds
        .filter((_, idx) => idx % 6 === 0)
        .map((c) => rgbToHex(c.r, c.g, c.b))
    )
  ).slice(0, 4);

  const avgContrast =
    objectSeeds.length > 0 && bgSeeds.length > 0
      ? minColorDist(
          objectSeeds[0].r,
          objectSeeds[0].g,
          objectSeeds[0].b,
          bgSeeds
        ) / 255
      : 0.5;

  return {
    dominantColorsHex: objHex,
    backgroundColorsHex: bgHex,
    segmentedBbox: {
      x: Math.max(0, segCx - segW / 2),
      y: Math.max(0, segCy - segH / 2),
      width: segW,
      height: segH,
      cx: segCx,
      cy: segCy,
    },
    foregroundContrast: Number(avgContrast.toFixed(2)),
  };
}

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
  objectSeeds: RgbSample[],
  bgSeeds: RgbSample[],
  predX: number,
  predY: number,
  curX: number,
  curY: number
): number {
  let score = 0;
  let wIdx = 0;
  let pIdx = 0;
  let coreFgSum = 0;
  let coreCount = 0;

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
        Math.abs(grad - tGrad) * 1.3;

      score += diff * weights[wIdx];

      if (px >= -3 && px <= 3 && py >= -3 && py <= 3) {
        coreFgSum += computeForegroundProb(r, g, b, objectSeeds, bgSeeds);
        coreCount++;
      }

      wIdx++;
      pIdx += 4;
    }
  }

  // Penalize candidates whose center core is background rather than the identified object!
  const avgCoreFg = coreCount > 0 ? coreFgSum / coreCount : 0.5;
  const bgRejectionPenalty = (1 - avgCoreFg) * 42;

  const dxPred = candX - predX;
  const dyPred = candY - predY;
  const dxCur = candX - curX;
  const dyCur = candY - curY;
  const distPenalty =
    Math.hypot(dxPred, dyPred) * 1.85 + (dxCur * dxCur + dyCur * dyCur) * 0.26;

  return score + bgRejectionPenalty + distPenalty;
}

/**
 * Refines (bestX, bestY) using CAMShift foreground probability center-of-mass
 * so the tracker locks onto the center of the identified object even as its pose changes.
 */
function refineWithForegroundCentroid(
  imgData: Uint8ClampedArray,
  bestX: number,
  bestY: number,
  objectSeeds: RgbSample[],
  bgSeeds: RgbSample[]
): { cx: number; cy: number } {
  let sumW = 0;
  let sumX = 0;
  let sumY = 0;
  const r = 6;

  for (let dy = -r; dy <= r; dy++) {
    const y = Math.min(TRACK_H - 1, Math.max(0, bestY + dy));
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.min(TRACK_W - 1, Math.max(0, bestX + dx));
      const i = (y * TRACK_W + x) * 4;
      const fg = computeForegroundProb(
        imgData[i],
        imgData[i + 1],
        imgData[i + 2],
        objectSeeds,
        bgSeeds
      );
      if (fg > 0.45) {
        const w = fg * fg;
        sumW += w;
        sumX += x * w;
        sumY += y * w;
      }
    }
  }

  if (sumW > 1.5) {
    const centX = sumX / sumW;
    const centY = sumY / sumW;
    return {
      cx: bestX * 0.65 + centX * 0.35,
      cy: bestY * 0.65 + centY * 0.35,
    };
  }
  return { cx: bestX, cy: bestY };
}

/**
 * Identifies the foreground object at `initialBbox` (separating it from the background)
 * and tracks it across frames of `sourceCanvas` using Foreground-Segmented Template Matching
 * + CAMShift Object Color Backprojection.
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

    const { objectSeeds, bgSeeds, segmentedWeights } = extractObjectAndBgSeeds(
      imgData,
      startPx,
      startPy
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
      weights: segmentedWeights,
      objectSeeds,
      bgSeeds,
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

  const searchRx = Math.max(7, Math.min(16, Math.ceil(clampedDt * TRACK_W * 1.45)));
  const searchRy = Math.max(6, Math.min(12, Math.ceil(clampedDt * TRACK_H * 1.45)));

  const stayX = Math.round(predPx);
  const stayY = Math.round(predPy);
  const stayScore = evaluateCandidate(
    imgData,
    stayX,
    stayY,
    state.initPatch,
    state.adaptivePatch,
    state.weights,
    state.objectSeeds,
    state.bgSeeds,
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

  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const s = evaluateCandidate(
        imgData,
        cx,
        cy,
        state.initPatch,
        state.adaptivePatch,
        state.weights,
        state.objectSeeds,
        state.bgSeeds,
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

  // Refine with CAMShift foreground object center-of-mass so it stays locked on the object
  let refinedPx = bestX;
  let refinedPy = bestY;
  const isConfidentMatch = bestScore < 105 && bestScore <= stayScore - 0.6;
  if (!isConfidentMatch && stayScore >= 105) {
    state.velX *= 0.7;
    state.velY *= 0.7;
    refinedPx = curPx + state.velX * clampedDt * TRACK_W * 0.3;
    refinedPy = curPy + state.velY * clampedDt * TRACK_H * 0.3;
  } else {
    const centroid = refineWithForegroundCentroid(
      imgData,
      bestX,
      bestY,
      state.objectSeeds,
      state.bgSeeds
    );
    refinedPx = centroid.cx;
    refinedPy = centroid.cy;

    if (bestScore < 85) {
      const currentPatch = new Float32Array(PATCH_DIM * PATCH_DIM * 4);
      extractPatch(imgData, Math.round(refinedPx), Math.round(refinedPy), currentPatch);
      for (let i = 0; i < state.adaptivePatch.length; i++) {
        state.adaptivePatch[i] =
          state.adaptivePatch[i] * 0.86 + currentPatch[i] * 0.14;
      }
    }
  }

  const maxStepNormX = 0.045;
  const maxStepNormY = 0.045;
  const rawNextCx = refinedPx / TRACK_W;
  const rawNextCy = refinedPy / TRACK_H;
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
