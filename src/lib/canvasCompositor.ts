import {
  getInterpolatedAnnotations,
  mergeBoundingBoxes,
} from '@/lib/editCompiler';
import { getRealtimeTrackedBbox } from '@/lib/realtimeObjectTracker';
import {
  AiCanvasDrawCommand,
  AiCustomAnimation,
  AiCustomParticles,
  BuiltInSceneId,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';

const svgImageCache = new Map<string, HTMLImageElement>();

type AiCompiledRenderFn = (
  ctx: CanvasRenderingContext2D,
  env: {
    ctx: CanvasRenderingContext2D;
    sourceCanvas: HTMLCanvasElement;
    cx: number;
    cy: number;
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
    width: number;
    height: number;
    scale: number;
    t: number;
    elapsed: number;
    duration: number;
    progress: number;
    frame: number;
    totalFrames: number;
    drawSvg: (
      svgStr: string,
      dx?: number,
      dy?: number,
      dw?: number,
      dh?: number
    ) => void;
  }
) => void;

const renderCodeCache = new Map<string, AiCompiledRenderFn | null>();

function getOrCompileRenderCode(rawCode: string): AiCompiledRenderFn | null {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const trimmed = rawCode.trim();
  if (renderCodeCache.has(trimmed)) {
    return renderCodeCache.get(trimmed) ?? null;
  }

  let body = trimmed;
  // Strip markdown code fences if the AI wrapped renderCode in ```js ... ```
  const fence = body.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
  if (fence) {
    body = fence[1].trim();
  }

  try {
    const fn = new Function(
      'ctx',
      'env',
      `const { sourceCanvas, cx, cy, x, y, w, h, r, width, height, scale, t, elapsed, duration, progress, frame, totalFrames, drawSvg } = env;\n${body}`
    ) as AiCompiledRenderFn;
    renderCodeCache.set(trimmed, fn);
    return fn;
  } catch (err) {
    console.warn('Failed to compile AI renderCode:', err);
    renderCodeCache.set(trimmed, null);
    return null;
  }
}

function getOrLoadSvgImage(rawSvg: string): HTMLImageElement | null {
  if (typeof window === 'undefined' || !rawSvg) return null;
  const trimmed = rawSvg.trim();
  const cached = svgImageCache.get(trimmed);
  if (cached) return cached;

  let svgMarkup = trimmed;
  const svgStart = svgMarkup.indexOf('<svg');
  const svgEnd = svgMarkup.lastIndexOf('</svg>');
  if (svgStart !== -1 && svgEnd !== -1) {
    svgMarkup = svgMarkup.slice(svgStart, svgEnd + 6);
  } else if (!svgMarkup.startsWith('<svg')) {
    svgMarkup = `<svg viewBox="0 0 200 200" width="400" height="400" xmlns="http://www.w3.org/2000/svg">${svgMarkup}</svg>`;
  }

  if (!/xmlns=/i.test(svgMarkup)) {
    svgMarkup = svgMarkup.replace(
      /<svg\b/i,
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }
  if (!/viewBox=/i.test(svgMarkup)) {
    svgMarkup = svgMarkup.replace(/<svg\b/i, '<svg viewBox="0 0 200 200"');
  }
  if (!/\bwidth=/i.test(svgMarkup)) {
    svgMarkup = svgMarkup.replace(
      /<svg\b/i,
      '<svg width="400" height="400"'
    );
  }

  try {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    svgImageCache.set(trimmed, img);
    return img;
  } catch {
    return null;
  }
}

function drawStarPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  spikes: number,
  outerR: number,
  innerR: number
) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / Math.max(3, spikes);
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}

function renderCustomParticles(
  ctx: CanvasRenderingContext2D,
  particles: AiCustomParticles,
  cx: number,
  cy: number,
  targetRadius: number,
  currentTime: number,
  resScale: number
) {
  const count = Math.min(120, Math.max(4, particles.count ?? 28));
  const colors =
    Array.isArray(particles.colors) && particles.colors.length > 0
      ? particles.colors
      : ['#ffb347', '#ff6b1a', '#fff3b0'];
  const speed = particles.speed ?? 1.2;
  const baseSize = (particles.size ?? 8) * resScale;
  const spread = (particles.spread ?? 1.35) * targetRadius;
  const direction = particles.direction ?? 'up';
  const shape = particles.shape ?? 'spark';

  ctx.save();
  for (let i = 0; i < count; i++) {
    const seed1 = ((i * 1.61803398875) % 1 + 1) % 1;
    const seed2 = ((i * 2.41421356237) % 1 + 1) % 1;
    const seed3 = ((i * 3.14159265359) % 1 + 1) % 1;
    const cycle = (currentTime * speed * (0.65 + seed1 * 0.7) + seed2 * 10) % 1;
    const alpha = Math.sin(cycle * Math.PI);

    let px = cx;
    let py = cy;
    if (direction === 'radial') {
      const angle = seed1 * Math.PI * 2 + currentTime * 0.4 * (seed2 - 0.5);
      const dist = cycle * spread * 1.4;
      px = cx + Math.cos(angle) * dist;
      py = cy + Math.sin(angle) * dist;
    } else if (direction === 'down') {
      px =
        cx +
        (seed1 - 0.5) * spread * 2 +
        Math.sin(currentTime * 3 + i) * 10 * resScale;
      py = cy - spread * 0.6 + cycle * spread * 1.8;
    } else if (direction === 'drift') {
      px =
        cx +
        (seed1 - 0.5) * spread * 2 +
        Math.cos(currentTime * 2 + i) * 18 * resScale;
      py =
        cy +
        (seed3 - 0.5) * spread * 2 +
        Math.sin(currentTime * 2.4 + i) * 18 * resScale;
    } else {
      // 'up'
      px =
        cx +
        (seed1 - 0.5) * spread * 1.8 +
        Math.sin(currentTime * 3.5 + i) * 8 * resScale;
      py = cy + spread * 0.6 - cycle * spread * 1.8;
    }

    const sz = baseSize * (0.55 + seed3 * 0.75) * (0.6 + 0.4 * alpha);
    const color = colors[i % colors.length];

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(currentTime * (seed2 - 0.5) * 4 + i);
    ctx.globalAlpha = Math.max(0.05, Math.min(1, alpha * 0.92));
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1d1a16';
    ctx.lineWidth = 1.5 * resScale;
    if (particles.glow !== false) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 10 * resScale;
    }

    if (shape === 'star' || shape === 'spark') {
      drawStarPath(ctx, 0, 0, shape === 'spark' ? 4 : 5, sz, sz * 0.38);
      ctx.fill();
    } else if (shape === 'heart') {
      ctx.beginPath();
      ctx.moveTo(0, sz * 0.35);
      ctx.bezierCurveTo(-sz, -sz * 0.35, -sz * 0.5, -sz, 0, -sz * 0.35);
      ctx.bezierCurveTo(sz * 0.5, -sz, sz, -sz * 0.35, 0, sz * 0.35);
      ctx.fill();
    } else if (shape === 'flame') {
      ctx.beginPath();
      ctx.moveTo(0, -sz * 1.2);
      ctx.quadraticCurveTo(sz * 0.8, 0, 0, sz);
      ctx.quadraticCurveTo(-sz * 0.8, 0, 0, -sz * 1.2);
      ctx.fill();
    } else if (shape === 'confetti') {
      ctx.fillRect(-sz * 0.6, -sz * 0.35, sz * 1.2, sz * 0.7);
    } else if (shape === 'bubble') {
      ctx.beginPath();
      ctx.arc(0, 0, sz * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * resScale;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, sz * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function renderCustomDrawCommands(
  ctx: CanvasRenderingContext2D,
  commands: AiCanvasDrawCommand[],
  cx: number,
  cy: number,
  targetRadius: number,
  resScale: number
) {
  ctx.save();
  ctx.translate(cx, cy);

  for (const cmd of commands) {
    ctx.save();
    const ox = (cmd.x ?? 0) * targetRadius;
    const oy = (cmd.y ?? 0) * targetRadius;
    ctx.translate(ox, oy);
    if (cmd.rotationDeg) {
      ctx.rotate((cmd.rotationDeg * Math.PI) / 180);
    }
    if (typeof cmd.opacity === 'number') {
      ctx.globalAlpha = Math.max(0, Math.min(1, cmd.opacity));
    }
    if (cmd.glowColor) {
      ctx.shadowColor = cmd.glowColor;
      ctx.shadowBlur = (cmd.glowBlur ?? 14) * resScale;
    }

    const r = (cmd.radius ?? 0.5) * targetRadius;
    const w = (cmd.width ?? 0.8) * targetRadius;
    const h = (cmd.height ?? 0.8) * targetRadius;

    if (Array.isArray(cmd.gradientColors) && cmd.gradientColors.length >= 2) {
      const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.25, r * 0.1, 0, 0, Math.max(r, w * 0.6));
      cmd.gradientColors.forEach((c, idx) => {
        grad.addColorStop(idx / (cmd.gradientColors!.length - 1), c);
      });
      ctx.fillStyle = grad;
    } else if (cmd.fill) {
      ctx.fillStyle = cmd.fill;
    }

    if (cmd.stroke) {
      ctx.strokeStyle = cmd.stroke;
      ctx.lineWidth = (cmd.lineWidth ?? 3) * resScale;
    }

    if (cmd.type === 'circle' || cmd.type === 'ring') {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      if (cmd.type !== 'ring' && (cmd.fill || cmd.gradientColors)) ctx.fill();
      if (cmd.stroke || cmd.type === 'ring') {
        if (!cmd.stroke) ctx.strokeStyle = cmd.fill || '#ffb347';
        ctx.lineWidth = (cmd.lineWidth ?? 4) * resScale;
        ctx.stroke();
      }
    } else if (cmd.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        0,
        0,
        (cmd.rx ?? 0.6) * targetRadius,
        (cmd.ry ?? 0.4) * targetRadius,
        0,
        0,
        Math.PI * 2
      );
      if (cmd.fill || cmd.gradientColors) ctx.fill();
      if (cmd.stroke) ctx.stroke();
    } else if (cmd.type === 'rect' || cmd.type === 'roundRect') {
      ctx.beginPath();
      ctx.roundRect(
        -w / 2,
        -h / 2,
        w,
        h,
        (cmd.cornerRadius ?? (cmd.type === 'roundRect' ? 10 : 0)) * resScale
      );
      if (cmd.fill || cmd.gradientColors) ctx.fill();
      if (cmd.stroke) ctx.stroke();
    } else if (cmd.type === 'star' || cmd.type === 'burst') {
      const spikes = cmd.spikes ?? (cmd.type === 'burst' ? 12 : 5);
      const inner = (cmd.innerRadius ?? (cmd.type === 'burst' ? 0.55 : 0.45)) * r;
      drawStarPath(ctx, 0, 0, spikes, r, inner);
      if (cmd.fill || cmd.gradientColors) ctx.fill();
      if (cmd.stroke) ctx.stroke();
    } else if (cmd.type === 'polygon' && Array.isArray(cmd.points) && cmd.points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(cmd.points[0].x * targetRadius, cmd.points[0].y * targetRadius);
      for (let i = 1; i < cmd.points.length; i++) {
        ctx.lineTo(cmd.points[i].x * targetRadius, cmd.points[i].y * targetRadius);
      }
      ctx.closePath();
      if (cmd.fill || cmd.gradientColors) ctx.fill();
      if (cmd.stroke) ctx.stroke();
    } else if (cmd.type === 'line' && Array.isArray(cmd.points) && cmd.points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(cmd.points[0].x * targetRadius, cmd.points[0].y * targetRadius);
      for (let i = 1; i < cmd.points.length; i++) {
        ctx.lineTo(cmd.points[i].x * targetRadius, cmd.points[i].y * targetRadius);
      }
      ctx.strokeStyle = cmd.stroke || cmd.fill || '#ffffff';
      ctx.lineWidth = (cmd.lineWidth ?? 3) * resScale;
      ctx.stroke();
    } else if (cmd.type === 'text' && cmd.text) {
      const fs = Math.round((cmd.fontSize ?? 26) * resScale);
      ctx.font = `800 ${fs}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (cmd.stroke) {
        ctx.lineWidth = (cmd.lineWidth ?? 4) * resScale;
        ctx.strokeText(cmd.text, 0, 0);
      }
      ctx.fillStyle = cmd.fill || '#ffffff';
      ctx.fillText(cmd.text, 0, 0);
    }

    ctx.restore();
  }

  ctx.restore();
}

function buildMaskPath(
  ctx: CanvasRenderingContext2D,
  annotations: ScreenAnnotation[],
  width: number,
  height: number,
  invertMask = false
) {
  ctx.beginPath();

  if (invertMask) {
    ctx.rect(0, 0, width, height);
  }

  const shapeAnns = annotations.filter((a) => a.tool !== 'arrow');
  const activeAnns = shapeAnns.length > 0 ? shapeAnns : annotations;

  if (activeAnns.length === 0) {
    if (!invertMask) {
      ctx.rect(0, 0, width, height);
    }
    return;
  }

  const scale = width / 960;

  for (const ann of activeAnns) {
    const b = ann.bbox;
    const x = b.x * width;
    const y = b.y * height;
    const w = b.width * width;
    const h = b.height * height;

    if (ann.tool === 'rect') {
      ctx.roundRect(x, y, w, h, 8 * scale);
    } else if (ann.tool === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (ann.tool === 'brush' && ann.points.length > 2) {
      // Smooth closed freehand polygon / lasso mask path
      const pts = ann.points;
      ctx.moveTo(pts[0].x * width, pts[0].y * height);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = ((pts[i].x + pts[i + 1].x) / 2) * width;
        const yc = ((pts[i].y + pts[i + 1].y) / 2) * height;
        ctx.quadraticCurveTo(pts[i].x * width, pts[i].y * height, xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x * width, last.y * height);
      ctx.closePath();
    } else {
      ctx.roundRect(x, y, w, h, 10 * scale);
    }
  }
}

/**
 * Renders one of 3 built-in HD resolution-independent procedural scenes
 * when no external video file is loaded.
 */
export function renderProceduralDemoScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  sceneId: BuiltInSceneId = 'scenic_valley'
) {
  const s = width / 960;

  if (sceneId === 'night_express') {
    // SCENE 2: TWILIGHT INDIGO EXPRESS TRAIN
    ctx.fillStyle = '#182438';
    ctx.fillRect(0, 0, width, height);

    // Full Moon (#fbf09c)
    ctx.save();
    ctx.fillStyle = '#fbf09c';
    ctx.strokeStyle = '#1d1a16';
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.24, 52 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Distant Mountains (#234c7a & #48586b)
    ctx.fillStyle = '#234c7a';
    ctx.beginPath();
    ctx.moveTo(0, height * 0.68);
    ctx.lineTo(width * 0.25, height * 0.42);
    ctx.lineTo(width * 0.52, height * 0.65);
    ctx.lineTo(width * 0.82, height * 0.46);
    ctx.lineTo(width, height * 0.66);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Viaduct Bridge (#c5ac7d & #544b43)
    const bridgeY = height * 0.68;
    ctx.fillStyle = '#aba18c';
    ctx.fillRect(0, bridgeY, width, height * 0.08);
    ctx.strokeRect(0, bridgeY, width, height * 0.08);

    for (let i = 0; i < 6; i++) {
      const archX = i * (width / 5.5);
      ctx.fillStyle = '#13151a';
      ctx.beginPath();
      ctx.arc(archX + 70 * s, height, 55 * s, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
    }

    // Signal Tower (Left) (#b82d23)
    ctx.fillStyle = '#f5f2e8';
    ctx.fillRect(width * 0.12, bridgeY - 130 * s, 44 * s, 130 * s);
    ctx.strokeRect(width * 0.12, bridgeY - 130 * s, 44 * s, 130 * s);
    ctx.fillStyle = '#b82d23';
    ctx.beginPath();
    ctx.arc(width * 0.12 + 22 * s, bridgeY - 95 * s, 12 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Moving Express Train (#b82d23 & #dfc992 glowing windows)
    const trainX = width * 0.42 + Math.sin(time * 1.1) * (width * 0.15);
    const trainY = bridgeY - 48 * s;
    ctx.fillStyle = '#b82d23';
    ctx.beginPath();
    ctx.roundRect(trainX - 160 * s, trainY, 320 * s, 46 * s, 8 * s);
    ctx.fill();
    ctx.stroke();

    // Glowing passenger windows
    ctx.fillStyle = '#fbf09c';
    for (let w = -130; w <= 100; w += 42) {
      ctx.fillRect(trainX + w * s, trainY + 10 * s, 28 * s, 18 * s);
      ctx.strokeRect(trainX + w * s, trainY + 10 * s, 28 * s, 18 * s);
    }
    ctx.restore();
    return;
  }

  if (sceneId === 'street_market') {
    // SCENE 3: WARM FESTIVAL BOULEVARD
    ctx.fillStyle = '#d9ceb4';
    ctx.fillRect(0, 0, width, height);

    const streetY = height * 0.72;
    ctx.save();
    ctx.strokeStyle = '#1d1a16';
    ctx.lineWidth = 2.5 * s;

    // Ground
    ctx.fillStyle = '#aba18c';
    ctx.fillRect(0, streetY, width, height - streetY);
    ctx.beginPath();
    ctx.moveTo(0, streetY);
    ctx.lineTo(width, streetY);
    ctx.stroke();

    // Left Timber Shophouse (#7a5133 & #ece5d3)
    ctx.fillStyle = '#ece5d3';
    ctx.fillRect(width * 0.08, streetY - 210 * s, 190 * s, 210 * s);
    ctx.strokeRect(width * 0.08, streetY - 210 * s, 190 * s, 210 * s);
    ctx.fillStyle = '#27513b';
    ctx.fillRect(width * 0.06, streetY - 228 * s, 220 * s, 26 * s);
    ctx.strokeRect(width * 0.06, streetY - 228 * s, 220 * s, 26 * s);

    // Hanging Festival Lanterns (Center-Top) (#b82d23 & #c6923a)
    for (let i = 0; i < 4; i++) {
      const lx = width * (0.36 + i * 0.09);
      const ly = height * 0.22 + Math.sin(time * 2 + i) * 6 * s;
      ctx.fillStyle = i % 2 === 0 ? '#b82d23' : '#c6923a';
      ctx.beginPath();
      ctx.ellipse(lx, ly, 18 * s, 24 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Moving Delivery Cart (Right) (#234c7a)
    const cartX = width * 0.72 + Math.cos(time * 1.3) * 35 * s;
    ctx.fillStyle = '#234c7a';
    ctx.beginPath();
    ctx.roundRect(cartX - 70 * s, streetY - 64 * s, 140 * s, 50 * s, 8 * s);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1d1a16';
    ctx.beginPath();
    ctx.arc(cartX - 40 * s, streetY - 6 * s, 16 * s, 0, Math.PI * 2);
    ctx.arc(cartX + 40 * s, streetY - 6 * s, 16 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // DEFAULT SCENE 1: SCENIC VALLEY (Warm Parchment Sky & Rolling Hills)
  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = '#bfd3db';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.45, height * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Rolling Hills
  ctx.fillStyle = '#85b296';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.72);
  ctx.quadraticCurveTo(width * 0.28, height * 0.52, width * 0.58, height * 0.72);
  ctx.quadraticCurveTo(width * 0.8, height * 0.58, width, height * 0.7);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const groundY = height * 0.74;
  ctx.fillStyle = '#d9ceb4';
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
  ctx.restore();

  // SUBJECT 1 (Top-Left): Drifting Hot Air Balloon (#b82d23 & #dfc992)
  ctx.save();
  const balloonX = width * 0.19 + Math.sin(time * 0.8) * 18 * s;
  const balloonY = height * 0.26 + Math.cos(time * 1.3) * 10 * s;
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5 * s;

  ctx.beginPath();
  ctx.moveTo(balloonX - 12 * s, balloonY + 34 * s);
  ctx.lineTo(balloonX - 8 * s, balloonY + 52 * s);
  ctx.moveTo(balloonX + 12 * s, balloonY + 34 * s);
  ctx.lineTo(balloonX + 8 * s, balloonY + 52 * s);
  ctx.stroke();

  ctx.fillStyle = '#7a5133';
  ctx.fillRect(balloonX - 12 * s, balloonY + 52 * s, 24 * s, 16 * s);
  ctx.strokeRect(balloonX - 12 * s, balloonY + 52 * s, 24 * s, 16 * s);

  ctx.fillStyle = '#b82d23';
  ctx.beginPath();
  ctx.arc(balloonX, balloonY, 38 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#dfc992';
  ctx.beginPath();
  ctx.ellipse(balloonX, balloonY, 16 * s, 38 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // SUBJECT 2 (Center): Clock Tower (#f5f2e8, #234c7a roof)
  ctx.save();
  const towerW = width * 0.16;
  const towerH = height * 0.42;
  const towerX = width * 0.42;
  const towerY = groundY - towerH;

  ctx.fillStyle = '#f5f2e8';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5 * s;
  ctx.fillRect(towerX, towerY, towerW, towerH);
  ctx.strokeRect(towerX, towerY, towerW, towerH);

  ctx.fillStyle = '#234c7a';
  ctx.beginPath();
  ctx.moveTo(towerX - 12 * s, towerY);
  ctx.lineTo(towerX + towerW / 2, towerY - 48 * s);
  ctx.lineTo(towerX + towerW + 12 * s, towerY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const clockCx = towerX + towerW / 2;
  const clockCy = towerY + 48 * s;
  ctx.fillStyle = '#dfc992';
  ctx.beginPath();
  ctx.arc(clockCx, clockCy, 24 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(clockCx, clockCy);
  ctx.lineTo(
    clockCx + Math.cos(time * 1.5) * 16 * s,
    clockCy + Math.sin(time * 1.5) * 16 * s
  );
  ctx.moveTo(clockCx, clockCy);
  ctx.lineTo(clockCx, clockCy - 12 * s);
  ctx.stroke();

  ctx.fillStyle = '#48586b';
  ctx.fillRect(towerX + 24 * s, towerY + 100 * s, 28 * s, 38 * s);
  ctx.strokeRect(towerX + 24 * s, towerY + 100 * s, 28 * s, 38 * s);
  ctx.fillRect(towerX + towerW - 52 * s, towerY + 100 * s, 28 * s, 38 * s);
  ctx.strokeRect(towerX + towerW - 52 * s, towerY + 100 * s, 28 * s, 38 * s);
  ctx.restore();

  // SUBJECT 3 (Right): Moving Vintage Coupe Car (#50793e Matcha Green)
  ctx.save();
  const carX = width * 0.76 + Math.sin(time * 1.4) * 28 * s;
  const carY = groundY + 14 * s;
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5 * s;

  ctx.fillStyle = '#50793e';
  ctx.beginPath();
  ctx.roundRect(carX - 85 * s, carY - 26 * s, 170 * s, 38 * s, 10 * s);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#729749';
  ctx.beginPath();
  ctx.roundRect(carX - 46 * s, carY - 54 * s, 92 * s, 30 * s, 8 * s);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#bfd3db';
  ctx.fillRect(carX - 36 * s, carY - 48 * s, 32 * s, 20 * s);
  ctx.strokeRect(carX - 36 * s, carY - 48 * s, 32 * s, 20 * s);
  ctx.fillRect(carX + 4 * s, carY - 48 * s, 32 * s, 20 * s);
  ctx.strokeRect(carX + 4 * s, carY - 48 * s, 32 * s, 20 * s);

  ctx.fillStyle = '#fbf09c';
  ctx.beginPath();
  ctx.arc(carX - 80 * s, carY - 10 * s, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  for (const wx of [carX - 48 * s, carX + 48 * s]) {
    ctx.fillStyle = '#1d1a16';
    ctx.beginPath();
    ctx.arc(wx, carY + 14 * s, 16 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ece5d3';
    ctx.beginPath();
    ctx.arc(wx, carY + 14 * s, 7 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders the video frame + all active TimelineEditItems for the current timestamp.
 * Supports arbitrary output resolution (720p, 1080p, 1440p, 4K) and Before/After split comparison.
 */
export function renderCompositedFrame(
  mainCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  currentTime: number,
  edits: TimelineEditItem[],
  splitComparisonX?: number // Optional 0.0..1.0 split-screen comparison wipe
) {
  const resScale = width / 960;
  const activeEdits = edits.filter(
    (e) => e.enabled && currentTime >= e.startTime && currentTime <= e.endTime
  );

  mainCtx.save();
  mainCtx.fillStyle = '#000000';
  mainCtx.fillRect(0, 0, width, height);

  let scale = 1;
  let focusX = 0.5;
  let focusY = 0.5;
  let shakeX = 0;
  let shakeY = 0;

  for (const edit of activeEdits) {
    const dynamicAnns = getInterpolatedAnnotations(
      edit.annotations,
      currentTime,
      edit.startTime,
      edit.endTime
    );

    if (edit.effectType === 'zoom') {
      const targetScale = edit.params.zoomScale ?? 1.75;
      const duration = Math.max(0.1, edit.endTime - edit.startTime);
      const elapsed = currentTime - edit.startTime;
      const remaining = edit.endTime - currentTime;
      const rampTime =
        edit.params.zoomEasing === 'instant' ? 0.01 : Math.min(0.35, duration * 0.25);

      let progress = 1;
      if (elapsed < rampTime) {
        progress = elapsed / rampTime;
      } else if (remaining < rampTime) {
        progress = remaining / rampTime;
      }
      const eased = progress * progress * (3 - 2 * progress);
      scale = 1 + (targetScale - 1) * eased;

      if (dynamicAnns.length > 0) {
        const baseMerged = mergeBoundingBoxes(dynamicAnns.map((a) => a.bbox));
        const trackedMerged =
          baseMerged.width * baseMerged.height < 0.85
            ? getRealtimeTrackedBbox(
                edit.id,
                sourceCanvas,
                baseMerged,
                currentTime,
                edit.startTime
              )
            : baseMerged;
        focusX = 0.5 + (trackedMerged.cx - 0.5) * eased;
        focusY = 0.5 + (trackedMerged.cy - 0.5) * eased;
      }
    }

    if (edit.effectType === 'camera_fx' && edit.params.cameraEffect === 'shake') {
      const intensity = (edit.params.intensity ?? 0.8) * 12 * resScale;
      shakeX = Math.sin(currentTime * 55) * intensity;
      shakeY = Math.cos(currentTime * 68) * intensity;
    }
  }

  mainCtx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
  mainCtx.scale(scale, scale);
  mainCtx.translate(-focusX * width, -focusY * height);

  mainCtx.drawImage(sourceCanvas, 0, 0, width, height);

  for (const edit of activeEdits) {
    const { effectType, params } = edit;
    const annotations = getInterpolatedAnnotations(
      edit.annotations,
      currentTime,
      edit.startTime,
      edit.endTime
    );

    // 1. GAUSSIAN BLUR / BOKEH
    if (effectType === 'blur') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');
      const scaledBlur = Math.max(2, Math.round((params.blurRadius ?? 16) * resScale));
      mainCtx.filter = `blur(${scaledBlur}px)`;
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.restore();
    }

    // 2. PIXELATE / MOSAIC
    if (effectType === 'pixelate') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      const blockSize = Math.max(6, Math.round((params.pixelBlockSize ?? 14) * resScale));
      const smallW = Math.max(8, Math.floor(width / blockSize));
      const smallH = Math.max(8, Math.floor(height / blockSize));

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = smallW;
      tempCanvas.height = smallH;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        tempCtx.drawImage(sourceCanvas, 0, 0, smallW, smallH);
        mainCtx.imageSmoothingEnabled = false;
        mainCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, width, height);
        mainCtx.imageSmoothingEnabled = true;
      }
      mainCtx.restore();
    }

    // 3. COLOR GRADING & TINTING
    if (effectType === 'color_grade') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      const sat = params.saturation ?? 100;
      const bri = params.brightness ?? 100;
      const con = params.contrast ?? 100;
      const sep = params.sepia ?? 0;
      const inv = params.invert ?? 0;
      const hue = params.hueRotate ?? 0;

      mainCtx.filter = `saturate(${sat}%) brightness(${bri}%) contrast(${con}%) sepia(${sep}%) invert(${inv}%) hue-rotate(${hue}deg)`;
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.filter = 'none';

      if (params.tintColor) {
        mainCtx.globalCompositeOperation = 'color';
        mainCtx.fillStyle = params.tintColor;
        mainCtx.globalAlpha = params.tintOpacity ?? 0.45;
        mainCtx.fillRect(0, 0, width, height);
        mainCtx.globalAlpha = 1;
        mainCtx.globalCompositeOperation = 'source-over';
      }
      mainCtx.restore();
    }

    // 4. HALFTONE / MANGA INK SHADER
    if (effectType === 'halftone_ink') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      // High-contrast ink wash base
      mainCtx.filter = 'grayscale(100%) contrast(195%) brightness(108%)';
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.filter = 'none';

      // Warm parchment multiply tint
      mainCtx.globalCompositeOperation = 'multiply';
      mainCtx.fillStyle = params.paperColor ?? '#ece5d3';
      mainCtx.fillRect(0, 0, width, height);

      // Stipple Halftone Dot Pattern
      mainCtx.globalCompositeOperation = 'source-over';
      mainCtx.fillStyle = params.inkColor ?? 'rgba(29, 26, 22, 0.24)';
      const step = Math.max(5, Math.round((params.dotSpacing ?? 7) * resScale));
      const bbox =
        annotations.length > 0 && !params.invertMask
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0, y: 0, width: 1, height: 1 };

      const startX = Math.floor(bbox.x * width);
      const endX = Math.ceil((bbox.x + bbox.width) * width);
      const startY = Math.floor(bbox.y * height);
      const endY = Math.ceil((bbox.y + bbox.height) * height);

      mainCtx.beginPath();
      for (let y = startY; y < endY; y += step) {
        const rowShift = (Math.floor(y / step) % 2) * (step * 0.5);
        for (let x = startX + rowShift; x < endX; x += step) {
          mainCtx.moveTo(x + step * 0.22, y);
          mainCtx.arc(x, y, step * 0.22, 0, Math.PI * 2);
        }
      }
      mainCtx.fill();
      mainCtx.restore();
    }

    // 5. CHROMATIC ABERRATION / RGB SPLIT
    if (effectType === 'chromatic_aberration') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      const offset = (params.aberrationOffset ?? 9) * resScale * (0.7 + 0.3 * Math.sin(currentTime * 18));
      mainCtx.globalCompositeOperation = 'screen';
      mainCtx.globalAlpha = 0.65;
      mainCtx.filter = 'hue-rotate(-40deg) saturate(220%)';
      mainCtx.drawImage(sourceCanvas, -offset, 0, width, height);
      mainCtx.filter = 'hue-rotate(140deg) saturate(220%)';
      mainCtx.drawImage(sourceCanvas, offset, 0, width, height);
      mainCtx.filter = 'none';
      mainCtx.restore();
    }

    // 6. OPEN-ENDED AI CUSTOM SHADER, PARTICLES, VECTOR SVG & PROCEDURAL CANVAS ENGINE
    if (
      (params.audioAssetId || params.audioAssetName) &&
      !params.renderCode &&
      !params.customSvg &&
      !params.svg &&
      !params.customDrawCommands?.length &&
      !params.customParticles &&
      !params.customCssFilter &&
      !params.customOverlayGradient &&
      effectType === 'custom_ai'
    ) {
      return;
    }

    const baseTargetBbox =
      annotations.length > 0
        ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
        : { x: 0.38, y: 0.32, width: 0.24, height: 0.36, cx: 0.5, cy: 0.5 };
    const editCombinedText = `${edit.prompt || ''} ${edit.summary || ''}`.toLowerCase();
    const shouldTrackObject =
      annotations.length > 0 &&
      baseTargetBbox.width * baseTargetBbox.height < 0.85 &&
      (/\b(follow|follows|following|track|tracks|tracking|moves|moving|chase|lock\s+on)\b/i.test(
        editCombinedText
      ) ||
        /\bzoom\b/i.test(editCombinedText));
    const targetBbox = shouldTrackObject
      ? getRealtimeTrackedBbox(
          edit.id,
          sourceCanvas,
          baseTargetBbox,
          currentTime,
          edit.startTime
        )
      : baseTargetBbox;
    const isPinpointDot =
      annotations.length > 0 && annotations.every((a) => a.tool === 'dot');

    // 6a. Custom CSS Filter & Custom Gradient Wash (inside or outside Box/Dot)
    if (params.customCssFilter || params.customOverlayGradient) {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      if (params.customCssFilter) {
        mainCtx.filter = params.customCssFilter;
        mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
        mainCtx.filter = 'none';
      }

      if (
        params.customOverlayGradient &&
        Array.isArray(params.customOverlayGradient.colors) &&
        params.customOverlayGradient.colors.length >= 2
      ) {
        const gCfg = params.customOverlayGradient;
        const gx = targetBbox.x * width;
        const gy = targetBbox.y * height;
        const gw = targetBbox.width * width;
        const gh = targetBbox.height * height;
        const grad =
          gCfg.type === 'radial'
            ? mainCtx.createRadialGradient(
                targetBbox.cx * width,
                targetBbox.cy * height,
                Math.min(gw, gh) * 0.05,
                targetBbox.cx * width,
                targetBbox.cy * height,
                Math.max(gw, gh) * 0.75
              )
            : mainCtx.createLinearGradient(gx, gy, gx + gw, gy + gh);

        gCfg.colors.forEach((col, idx) => {
          grad.addColorStop(idx / (gCfg.colors.length - 1), col);
        });
        mainCtx.globalCompositeOperation = params.customBlendMode ?? 'overlay';
        mainCtx.globalAlpha = gCfg.opacity ?? 0.5;
        mainCtx.fillStyle = grad;
        mainCtx.fillRect(0, 0, width, height);
        mainCtx.globalAlpha = 1;
        mainCtx.globalCompositeOperation = 'source-over';
      }
      mainCtx.restore();
    }

    // Compute animated transform state for custom AI objects/drawings/particles
    const anim: AiCustomAnimation = params.customAnimation ?? {};
    const clipDuration = Math.max(0.1, edit.endTime - edit.startTime);
    const elapsed = Math.max(0, currentTime - edit.startTime);
    const remaining = Math.max(0, edit.endTime - currentTime);
    const progress01 = Math.min(1, Math.max(0, elapsed / clipDuration));

    let baseCxNorm = targetBbox.cx + (anim.offsetX ?? 0);
    let baseCyNorm = targetBbox.cy + (anim.offsetY ?? 0);
    if (typeof anim.moveToX === 'number') {
      baseCxNorm = baseCxNorm + (anim.moveToX - baseCxNorm) * progress01;
    }
    if (typeof anim.moveToY === 'number') {
      baseCyNorm = baseCyNorm + (anim.moveToY - baseCyNorm) * progress01;
    }

    const bobAmp = (anim.bobAmplitude ?? 5) * resScale;
    const bobSpd = anim.bobSpeed ?? 4.2;
    const bobOffsetY = Math.sin(currentTime * bobSpd) * bobAmp;

    const shakeAmp = (anim.shakeAmount ?? 0) * resScale;
    const animShakeX = shakeAmp ? Math.sin(currentTime * 48) * shakeAmp : 0;
    const animShakeY = shakeAmp ? Math.cos(currentTime * 56) * shakeAmp : 0;

    const pulseAmp = anim.pulseAmount ?? 0.04;
    const pulseSpd = anim.pulseSpeed ?? 4.5;
    let animScale = (anim.scale ?? 1.0) * (1 + Math.sin(currentTime * pulseSpd) * pulseAmp);
    let animAlpha = anim.opacity ?? 1.0;
    let enterSlideY = 0;
    let enterSpinRad = 0;

    const enterTime = Math.min(0.28, clipDuration * 0.25);
    if (elapsed > 0.02 && elapsed < enterTime && anim.enter !== 'none') {
      const t = elapsed / Math.max(0.01, enterTime);
      const springBounce = 1 + Math.sin(t * Math.PI) * 0.14;
      if (anim.enter === 'fade') {
        animAlpha *= 0.4 + 0.6 * t;
      } else if (anim.enter === 'slide_down') {
        enterSlideY = (1 - t) * -28 * resScale;
      } else if (anim.enter === 'slide_up') {
        enterSlideY = (1 - t) * 28 * resScale;
      } else if (anim.enter === 'spin') {
        animScale *= springBounce;
        enterSpinRad = (1 - t) * Math.PI * 0.5;
      } else {
        // Gentle elastic pop bounce that stays fully visible at frame 0
        animScale *= springBounce;
      }
    }

    const exitTime = Math.min(0.2, clipDuration * 0.18);
    if (remaining > 0.01 && remaining < exitTime && anim.exit && anim.exit !== 'none') {
      const t = remaining / Math.max(0.01, exitTime);
      if (anim.exit === 'pop') {
        animScale *= 0.5 + 0.5 * t;
        animAlpha *= 0.3 + 0.7 * t;
      } else if (anim.exit === 'fade') {
        animAlpha *= 0.3 + 0.7 * t;
      }
    }

    const spinRad =
      ((anim.spinSpeed ?? 0) * elapsed * Math.PI) / 180 + enterSpinRad;

    const rawBoxRadius = isPinpointDot
      ? Math.min(width, height) * 0.115
      : Math.min(targetBbox.width * width, targetBbox.height * height) * 0.5;
    const baseRadius = Math.max(48 * resScale, Math.min(240 * resScale, rawBoxRadius));
    const drawCx = baseCxNorm * width + animShakeX;
    const drawCy = baseCyNorm * height + bobOffsetY + enterSlideY + animShakeY;

    // 6b. Custom Procedural Particle Emitter
    if (params.customParticles) {
      renderCustomParticles(
        mainCtx,
        params.customParticles,
        drawCx,
        drawCy,
        baseRadius * (anim.scale ?? 1.0),
        currentTime,
        resScale
      );
    }

    // 6c. Custom AI-Authored Vector SVG Artwork (`params.customSvg` / `params.svg`)
    let renderedCustomSvg = false;
    const svgSource = params.customSvg || params.svg;
    if (svgSource && typeof svgSource === 'string') {
      const svgImg = getOrLoadSvgImage(svgSource);
      if (svgImg && svgImg.complete && svgImg.naturalWidth > 0) {
        const size = baseRadius * 2.15 * animScale;
        mainCtx.save();
        mainCtx.translate(drawCx, drawCy);
        if (spinRad !== 0) {
          mainCtx.rotate(spinRad);
        }
        mainCtx.globalAlpha = Math.max(0, Math.min(1, animAlpha));
        mainCtx.drawImage(svgImg, -size / 2, -size / 2, size, size);
        mainCtx.restore();
        renderedCustomSvg = true;
      }
    }

    // 6d. Direct Per-Frame AI Canvas 2D Execution (`params.renderCode`)
    let executedRenderCode = false;
    if (params.renderCode && typeof params.renderCode === 'string') {
      const compiledFn = getOrCompileRenderCode(params.renderCode);
      if (compiledFn) {
        const totalFrames = Math.max(1, Math.round(clipDuration * 30));
        const currentFrame = Math.min(
          totalFrames,
          Math.max(0, Math.round(elapsed * 30))
        );
        const boxX = targetBbox.x * width;
        const boxY = targetBbox.y * height;
        const boxW = targetBbox.width * width;
        const boxH = targetBbox.height * height;

        mainCtx.save();
        try {
          // When AI renderCode transforms/spins/redraws sourceCanvas without a clip/filter, clear the old un-transformed frame behind it to pure black (#000000)
          if (
            /\bdrawImage\s*\(\s*sourceCanvas\b/.test(params.renderCode) &&
            !/\bctx\.clip\s*\(/.test(params.renderCode)
          ) {
            const usesSubRegionCrop =
              /drawImage\s*\(\s*sourceCanvas\s*,[^)]*,[^)]*,[^)]*,[^)]*,[^)]*,/.test(
                params.renderCode
              );
            mainCtx.fillStyle = '#000000';
            if (usesSubRegionCrop && targetBbox.width * targetBbox.height < 0.65) {
              mainCtx.fillRect(boxX, boxY, boxW, boxH);
            } else {
              mainCtx.fillRect(0, 0, width, height);
            }
          }

          const isPivotZoomCode =
            shouldTrackObject &&
            /\bscale\s*\(/.test(params.renderCode) &&
            /\bdrawImage\s*\(\s*sourceCanvas\b/.test(params.renderCode) &&
            !/translate\s*\(\s*width\s*\/\s*2/.test(params.renderCode);

          const initCxPx = baseTargetBbox.cx * width;
          const initCyPx = baseTargetBbox.cy * height;
          const trackedCxPx = targetBbox.cx * width;
          const trackedCyPx = targetBbox.cy * height;

          const effectiveCx = isPivotZoomCode
            ? Math.min(
                width,
                Math.max(0, initCxPx + (trackedCxPx - initCxPx) * 1.85)
              )
            : trackedCxPx;
          const effectiveCy = isPivotZoomCode
            ? Math.min(
                height,
                Math.max(0, initCyPx + (trackedCyPx - initCyPx) * 1.85)
              )
            : trackedCyPx;

          compiledFn(mainCtx, {
            ctx: mainCtx,
            sourceCanvas,
            cx: effectiveCx,
            cy: effectiveCy,
            x: boxX,
            y: boxY,
            w: boxW,
            h: boxH,
            r: baseRadius,
            width,
            height,
            scale: resScale,
            t: currentTime,
            elapsed,
            duration: clipDuration,
            progress: progress01,
            frame: currentFrame,
            totalFrames,
            drawSvg: (
              svgStr: string,
              dx?: number,
              dy?: number,
              dw?: number,
              dh?: number
            ) => {
              const img = getOrLoadSvgImage(svgStr);
              if (img && img.complete && img.naturalWidth > 0) {
                const wDraw = dw ?? baseRadius * 2;
                const hDraw = dh ?? baseRadius * 2;
                const xDraw = dx ?? trackedCxPx - wDraw / 2;
                const yDraw = dy ?? trackedCyPx - hDraw / 2;
                mainCtx.drawImage(img, xDraw, yDraw, wDraw, hDraw);
              }
            },
          });
          executedRenderCode = true;
        } catch (err) {
          console.warn('Error executing AI renderCode frame:', err);
        }
        mainCtx.restore();
      }
    }

    // 6e. Custom Procedural Canvas 2D Draw Commands (`params.customDrawCommands`)
    if (
      Array.isArray(params.customDrawCommands) &&
      params.customDrawCommands.length > 0
    ) {
      mainCtx.save();
      mainCtx.translate(drawCx, drawCy);
      if (spinRad !== 0) {
        mainCtx.rotate(spinRad);
      }
      mainCtx.scale(animScale, animScale);
      mainCtx.globalAlpha = Math.max(0, Math.min(1, animAlpha));
      renderCustomDrawCommands(
        mainCtx,
        params.customDrawCommands,
        0,
        0,
        baseRadius,
        resScale
      );
      mainCtx.restore();
    }

    // 6f. Built-in Instant Vector Fallback for Cool Orange / Generative V2V Synthesis
    const combinedPromptText = `${edit.prompt || ''} ${edit.summary || ''} ${params.generativePrompt || ''} ${params.stickerObject || ''}`.toLowerCase();
    const wantsOrangeObject =
      !renderedCustomSvg &&
      !executedRenderCode &&
      (params.stickerObject === 'cool_orange' ||
        params.stickerObject === 'orange' ||
        /\b(add|place|put|spawn|draw)\b.*\borange\b/i.test(combinedPromptText) ||
        /\bcool\s+orange\b/i.test(combinedPromptText));

    if (wantsOrangeObject) {
      const r = baseRadius * animScale;

      mainCtx.save();
      mainCtx.translate(drawCx, drawCy);
      if (spinRad !== 0) {
        mainCtx.rotate(spinRad);
      }
      mainCtx.globalAlpha = Math.max(0, Math.min(1, animAlpha));

      // Soft ground/drop shadow
      mainCtx.fillStyle = 'rgba(29, 26, 22, 0.28)';
      mainCtx.beginPath();
      mainCtx.ellipse(0, r * 0.95, r * 0.72, r * 0.18, 0, 0, Math.PI * 2);
      mainCtx.fill();

      // Stem
      mainCtx.fillStyle = '#544b43';
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 2.5 * resScale;
      mainCtx.beginPath();
      mainCtx.roundRect(-r * 0.08, -r * 1.18, r * 0.16, r * 0.26, 3 * resScale);
      mainCtx.fill();
      mainCtx.stroke();

      // Green Leaf
      mainCtx.fillStyle = '#50793e';
      mainCtx.beginPath();
      mainCtx.moveTo(0, -r * 1.02);
      mainCtx.quadraticCurveTo(r * 0.45, -r * 1.38, r * 0.68, -r * 0.96);
      mainCtx.quadraticCurveTo(r * 0.32, -r * 0.78, 0, -r * 1.02);
      mainCtx.closePath();
      mainCtx.fill();
      mainCtx.stroke();

      // Orange Fruit Body with 3D Radial Gradient
      const orangeGrad = mainCtx.createRadialGradient(
        -r * 0.28,
        -r * 0.28,
        r * 0.12,
        0,
        0,
        r
      );
      orangeGrad.addColorStop(0, '#ffb347');
      orangeGrad.addColorStop(0.55, '#ff7b1a');
      orangeGrad.addColorStop(1, '#d94e0f');

      mainCtx.fillStyle = orangeGrad;
      mainCtx.beginPath();
      mainCtx.arc(0, 0, r, 0, Math.PI * 2);
      mainCtx.fill();
      mainCtx.lineWidth = 3 * resScale;
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.stroke();

      // Citrus Peel Dimples
      mainCtx.fillStyle = 'rgba(184, 45, 35, 0.28)';
      for (const [dx, dy] of [
        [-0.52, 0.32],
        [-0.38, 0.54],
        [0.48, 0.38],
        [0.58, 0.12],
        [0.35, -0.52],
      ]) {
        mainCtx.beginPath();
        mainCtx.arc(r * dx, r * dy, 2.2 * resScale, 0, Math.PI * 2);
        mainCtx.fill();
      }

      // Cool Sunglasses (Wayfarer Shades + Glint)
      const bridgeY = -r * 0.1;
      const lensW = r * 0.56;
      const lensH = r * 0.36;

      // Sunglasses Top Bar
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 4 * resScale;
      mainCtx.beginPath();
      mainCtx.moveTo(-r * 0.88, bridgeY - lensH * 0.35);
      mainCtx.lineTo(r * 0.88, bridgeY - lensH * 0.35);
      mainCtx.stroke();

      // Left & Right Lenses
      mainCtx.fillStyle = '#1d1a16';
      mainCtx.beginPath();
      mainCtx.roundRect(-r * 0.68, bridgeY - lensH * 0.45, lensW, lensH, 6 * resScale);
      mainCtx.roundRect(r * 0.12, bridgeY - lensH * 0.45, lensW, lensH, 6 * resScale);
      mainCtx.fill();
      mainCtx.lineWidth = 2.5 * resScale;
      mainCtx.strokeStyle = '#ece5d3';
      mainCtx.stroke();

      // White Diagonal Cool Glint on Lenses
      mainCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      mainCtx.lineWidth = 3 * resScale;
      mainCtx.beginPath();
      mainCtx.moveTo(-r * 0.54, bridgeY - lensH * 0.22);
      mainCtx.lineTo(-r * 0.36, bridgeY + lensH * 0.22);
      mainCtx.moveTo(r * 0.26, bridgeY - lensH * 0.22);
      mainCtx.lineTo(r * 0.44, bridgeY + lensH * 0.22);
      mainCtx.stroke();

      // Confident Cool Smirk
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 3 * resScale;
      mainCtx.lineCap = 'round';
      mainCtx.beginPath();
      mainCtx.arc(r * 0.05, r * 0.24, r * 0.28, 0.15 * Math.PI, 0.82 * Math.PI);
      mainCtx.stroke();

      mainCtx.restore();
    } else if (
      effectType === 'generative_replace' &&
      !renderedCustomSvg &&
      !params.customDrawCommands?.length
    ) {
      const style = params.generativeStyle ?? 'gold_aura';
      const stylePalette: Record<string, { primary: string; secondary: string }> = {
        fire: { primary: '#b82d23', secondary: '#c6923a' },
        hologram: { primary: '#4479a8', secondary: '#bfd3db' },
        watercolor: { primary: '#50793e', secondary: '#dfc992' },
        cyber: { primary: '#234c7a', secondary: '#fbf09c' },
        gold_aura: { primary: '#c6923a', secondary: '#fbf09c' },
      };
      const pal = stylePalette[style] ?? stylePalette.gold_aura;

      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, false);
      mainCtx.clip();

      mainCtx.filter = 'contrast(135%) saturate(165%)';
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.filter = 'none';

      const grad = mainCtx.createLinearGradient(
        targetBbox.x * width,
        targetBbox.y * height,
        (targetBbox.x + targetBbox.width) * width,
        (targetBbox.y + targetBbox.height) * height
      );
      grad.addColorStop(0, pal.primary);
      grad.addColorStop(0.5 + 0.3 * Math.sin(currentTime * 4), pal.secondary);
      grad.addColorStop(1, pal.primary);

      mainCtx.globalCompositeOperation = 'overlay';
      mainCtx.globalAlpha = 0.58;
      mainCtx.fillStyle = grad;
      mainCtx.fillRect(0, 0, width, height);

      // Animated synthesis shimmer scanlines inside mask
      mainCtx.globalCompositeOperation = 'source-over';
      mainCtx.strokeStyle = pal.secondary;
      mainCtx.globalAlpha = 0.45;
      mainCtx.lineWidth = 2 * resScale;
      const scanOffset = (currentTime * 60 * resScale) % (16 * resScale);
      for (
        let y = targetBbox.y * height + scanOffset;
        y < (targetBbox.y + targetBbox.height) * height;
        y += 16 * resScale
      ) {
        mainCtx.beginPath();
        mainCtx.moveTo(targetBbox.x * width, y);
        mainCtx.lineTo((targetBbox.x + targetBbox.width) * width, y);
        mainCtx.stroke();
      }
      mainCtx.restore();
    }

    // 7. SPOTLIGHT
    if (effectType === 'spotlight') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, true);
      mainCtx.clip('evenodd');
      mainCtx.fillStyle = `rgba(29, 26, 22, ${params.dimOpacity ?? 0.72})`;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

    // 8. NEON / WARM GLOW
    if (effectType === 'neon_glow') {
      const glowColor = params.glowColor ?? '#b82d23';
      const pulseFactor = params.pulse ? 0.75 + 0.35 * Math.sin(currentTime * 8) : 1;

      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, false);
      mainCtx.shadowColor = glowColor;
      mainCtx.shadowBlur = (params.glowIntensity ?? 24) * pulseFactor * resScale;
      mainCtx.strokeStyle = glowColor;
      mainCtx.lineWidth = 4 * resScale;
      mainCtx.stroke();

      mainCtx.clip();
      mainCtx.globalCompositeOperation = 'screen';
      mainCtx.fillStyle = glowColor;
      mainCtx.globalAlpha = 0.32 * pulseFactor;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

    // 9. CALLOUT SHAPE
    if (effectType === 'callout_shape') {
      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.35, y: 0.3, width: 0.3, height: 0.4, cx: 0.5, cy: 0.5 };

      const rx = bbox.x * width;
      const ry = bbox.y * height;
      const rw = bbox.width * width;
      const rh = bbox.height * height;
      const color = params.shapeColor ?? '#b82d23';

      mainCtx.save();
      mainCtx.strokeStyle = color;
      mainCtx.shadowColor = color;
      mainCtx.shadowBlur = 8 * resScale;
      mainCtx.lineWidth = 4 * resScale;

      if (params.shapeType === 'brackets') {
        const corner = Math.min(rw, rh) * 0.25;
        mainCtx.beginPath();
        mainCtx.moveTo(rx, ry + corner);
        mainCtx.lineTo(rx, ry);
        mainCtx.lineTo(rx + corner, ry);
        mainCtx.moveTo(rx + rw - corner, ry);
        mainCtx.lineTo(rx + rw, ry);
        mainCtx.lineTo(rx + rw, ry + corner);
        mainCtx.moveTo(rx + rw, ry + rh - corner);
        mainCtx.lineTo(rx + rw, ry + rh);
        mainCtx.lineTo(rx + rw - corner, ry + rh);
        mainCtx.moveTo(rx + corner, ry + rh);
        mainCtx.lineTo(rx, ry + rh);
        mainCtx.lineTo(rx, ry + rh - corner);
        mainCtx.stroke();
      } else if (params.shapeType === 'arrow') {
        const bounce = Math.sin(currentTime * 9) * 10 * resScale;
        const tipX = bbox.cx * width;
        const tipY = ry - 8 * resScale + bounce;
        mainCtx.fillStyle = color;
        mainCtx.beginPath();
        mainCtx.moveTo(tipX, tipY);
        mainCtx.lineTo(tipX - 16 * resScale, tipY - 26 * resScale);
        mainCtx.lineTo(tipX - 6 * resScale, tipY - 26 * resScale);
        mainCtx.lineTo(tipX - 6 * resScale, tipY - 56 * resScale);
        mainCtx.lineTo(tipX + 6 * resScale, tipY - 56 * resScale);
        mainCtx.lineTo(tipX + 6 * resScale, tipY - 26 * resScale);
        mainCtx.lineTo(tipX + 16 * resScale, tipY - 26 * resScale);
        mainCtx.closePath();
        ctx_fill_stroke(mainCtx, resScale);
      } else {
        mainCtx.setLineDash([14 * resScale, 8 * resScale]);
        mainCtx.lineDashOffset = -currentTime * 45 * resScale;
        mainCtx.beginPath();
        mainCtx.ellipse(
          rx + rw / 2,
          ry + rh / 2,
          rw / 2 + 8 * resScale,
          rh / 2 + 8 * resScale,
          0,
          0,
          Math.PI * 2
        );
        mainCtx.stroke();
      }
      mainCtx.restore();
    }

    // 10. TEXT OVERLAY PLAQUE
    if (effectType === 'text_overlay' && params.text) {
      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.25, y: 0.72, width: 0.5, height: 0.15, cx: 0.5, cy: 0.8 };

      const tx = bbox.cx * width;
      const ty = Math.max(48 * resScale, bbox.y * height - 14 * resScale);
      const fontSize = Math.round((params.fontSize ?? 30) * resScale);

      mainCtx.save();
      mainCtx.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
      mainCtx.textAlign = 'center';
      mainCtx.textBaseline = 'bottom';

      const metrics = mainCtx.measureText(params.text);
      const padX = 16 * resScale;
      const padY = 8 * resScale;

      mainCtx.fillStyle = '#ece5d3';
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 2.5 * resScale;
      const boxX = tx - metrics.width / 2 - padX;
      const boxY = ty - fontSize - padY;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + padY * 2;
      mainCtx.fillRect(boxX, boxY, boxW, boxH);
      mainCtx.strokeRect(boxX, boxY, boxW, boxH);

      mainCtx.fillStyle = '#1d1a16';
      const rOff = 5 * resScale;
      for (const [rx, ry] of [
        [boxX + rOff, boxY + rOff],
        [boxX + boxW - rOff, boxY + rOff],
        [boxX + rOff, boxY + boxH - rOff],
        [boxX + boxW - rOff, boxY + boxH - rOff],
      ]) {
        mainCtx.beginPath();
        mainCtx.arc(rx, ry, 2 * resScale, 0, Math.PI * 2);
        mainCtx.fill();
      }

      mainCtx.fillStyle = '#1d1a16';
      mainCtx.fillText(params.text, tx, ty - 2 * resScale);
      mainCtx.restore();
    }

    // 11. CAMERA FX
    if (effectType === 'camera_fx') {
      mainCtx.save();
      if (params.cameraEffect === 'cinema_bars') {
        const barH = height * 0.12;
        mainCtx.fillStyle = '#1d1a16';
        mainCtx.fillRect(0, 0, width, barH);
        mainCtx.fillRect(0, height - barH, width, barH);
      } else if (params.cameraEffect === 'vignette') {
        const radGrad = mainCtx.createRadialGradient(
          width / 2,
          height / 2,
          width * 0.22,
          width / 2,
          height / 2,
          width * 0.65
        );
        radGrad.addColorStop(0, 'rgba(29,26,22,0)');
        radGrad.addColorStop(1, 'rgba(29,26,22,0.78)');
        mainCtx.fillStyle = radGrad;
        mainCtx.fillRect(0, 0, width, height);
      } else if (params.cameraEffect === 'vhs_glitch') {
        mainCtx.globalCompositeOperation = 'screen';
        mainCtx.globalAlpha = 0.45;
        const offset = Math.sin(currentTime * 35) * 8 * resScale;
        mainCtx.drawImage(sourceCanvas, offset, 0, width, height);
      } else if (params.cameraEffect === 'flash') {
        const flashAlpha = Math.max(0, Math.sin(currentTime * 22) * 0.55);
        mainCtx.fillStyle = `rgba(245, 242, 232, ${flashAlpha})`;
        mainCtx.fillRect(0, 0, width, height);
      }
      mainCtx.restore();
    }
  }

  mainCtx.restore();

  // Guarantee pure black (#000000) behind any region cleared via ctx.clearRect()
  mainCtx.save();
  mainCtx.globalCompositeOperation = 'destination-over';
  mainCtx.fillStyle = '#000000';
  mainCtx.fillRect(0, 0, width, height);
  mainCtx.restore();

  // Optional Before / After Split-Screen Wipe Comparison
  if (
    typeof splitComparisonX === 'number' &&
    splitComparisonX > 0.01 &&
    splitComparisonX < 0.99
  ) {
    const splitPx = Math.round(splitComparisonX * width);
    mainCtx.save();
    mainCtx.beginPath();
    mainCtx.rect(0, 0, splitPx, height);
    mainCtx.clip();
    mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
    mainCtx.restore();

    // Draw Split Divider Line & Labels
    mainCtx.save();
    mainCtx.strokeStyle = '#1d1a16';
    mainCtx.lineWidth = 3 * resScale;
    mainCtx.beginPath();
    mainCtx.moveTo(splitPx, 0);
    mainCtx.lineTo(splitPx, height);
    mainCtx.stroke();

    mainCtx.fillStyle = '#ece5d3';
    mainCtx.fillRect(splitPx - 64 * resScale, height - 34 * resScale, 56 * resScale, 22 * resScale);
    mainCtx.strokeRect(splitPx - 64 * resScale, height - 34 * resScale, 56 * resScale, 22 * resScale);
    mainCtx.fillRect(splitPx + 8 * resScale, height - 34 * resScale, 56 * resScale, 22 * resScale);
    mainCtx.strokeRect(splitPx + 8 * resScale, height - 34 * resScale, 56 * resScale, 22 * resScale);

    mainCtx.fillStyle = '#1d1a16';
    mainCtx.font = `bold ${Math.round(11 * resScale)}px sans-serif`;
    mainCtx.textAlign = 'center';
    mainCtx.fillText('BEFORE', splitPx - 36 * resScale, height - 19 * resScale);
    mainCtx.fillText('AFTER', splitPx + 36 * resScale, height - 19 * resScale);
    mainCtx.restore();
  }
}

function ctx_fill_stroke(ctx: CanvasRenderingContext2D, resScale = 1) {
  ctx.fill();
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2 * resScale;
  ctx.stroke();
}
