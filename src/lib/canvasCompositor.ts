import {
  getInterpolatedAnnotations,
  mergeBoundingBoxes,
} from '@/lib/editCompiler';
import {
  BuiltInSceneId,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';

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
  mainCtx.clearRect(0, 0, width, height);

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
        const merged = mergeBoundingBoxes(dynamicAnns.map((a) => a.bbox));
        focusX = 0.5 + (merged.cx - 0.5) * eased;
        focusY = 0.5 + (merged.cy - 0.5) * eased;
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

    // 6. GENERATIVE V2V / INPAINT SYNTHESIS PREVIEW LAYER
    if (effectType === 'generative_replace') {
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

      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.2, y: 0.2, width: 0.6, height: 0.6, cx: 0.5, cy: 0.5 };

      const grad = mainCtx.createLinearGradient(
        bbox.x * width,
        bbox.y * height,
        (bbox.x + bbox.width) * width,
        (bbox.y + bbox.height) * height
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
        let y = bbox.y * height + scanOffset;
        y < (bbox.y + bbox.height) * height;
        y += 16 * resScale
      ) {
        mainCtx.beginPath();
        mainCtx.moveTo(bbox.x * width, y);
        mainCtx.lineTo((bbox.x + bbox.width) * width, y);
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
