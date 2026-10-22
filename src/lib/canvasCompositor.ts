import { mergeBoundingBoxes } from '@/lib/editCompiler';
import { ScreenAnnotation, TimelineEditItem } from '@/types/editor';

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

  if (annotations.length === 0) {
    if (!invertMask) {
      ctx.rect(0, 0, width, height);
    }
    return;
  }

  for (const ann of annotations) {
    const b = ann.bbox;
    const x = b.x * width;
    const y = b.y * height;
    const w = b.width * width;
    const h = b.height * height;

    if (ann.tool === 'rect') {
      ctx.roundRect(x, y, w, h, 8);
    } else if (ann.tool === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (ann.tool === 'brush' && ann.points.length > 2) {
      ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.35);
    } else {
      ctx.roundRect(x, y, w, h, 10);
    }
  }
}

/**
 * Renders an original, clean ink-outlined scenic animation using the warm parchment
 * and muted earth/vermilion/indigo/matcha palette when no custom video file is loaded.
 */
export function renderProceduralDemoScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
) {
  // 1. Warm Parchment Sky Backdrop (#ece5d3)
  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, width, height);

  // Soft distant hills in sage & warm stone (#85b296 & #c5ac7d)
  ctx.save();
  ctx.fillStyle = '#bfd3db';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;
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

  // Foreground Road / Ground (#d9ceb4 & #aba18c)
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
  const balloonX = width * 0.19 + Math.sin(time * 0.8) * 18;
  const balloonY = height * 0.26 + Math.cos(time * 1.3) * 10;
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;

  // Basket ropes
  ctx.beginPath();
  ctx.moveTo(balloonX - 12, balloonY + 34);
  ctx.lineTo(balloonX - 8, balloonY + 52);
  ctx.moveTo(balloonX + 12, balloonY + 34);
  ctx.lineTo(balloonX + 8, balloonY + 52);
  ctx.stroke();

  // Basket (#7a5133)
  ctx.fillStyle = '#7a5133';
  ctx.fillRect(balloonX - 12, balloonY + 52, 24, 16);
  ctx.strokeRect(balloonX - 12, balloonY + 52, 24, 16);

  // Balloon Envelope (#b82d23)
  ctx.fillStyle = '#b82d23';
  ctx.beginPath();
  ctx.arc(balloonX, balloonY, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Center stripe (#dfc992)
  ctx.fillStyle = '#dfc992';
  ctx.beginPath();
  ctx.ellipse(balloonX, balloonY, 16, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // SUBJECT 2 (Center): Clock Tower / Studio Building (#f5f2e8, #234c7a roof)
  ctx.save();
  const towerW = width * 0.16;
  const towerH = height * 0.42;
  const towerX = width * 0.42;
  const towerY = groundY - towerH;

  ctx.fillStyle = '#f5f2e8';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;
  ctx.fillRect(towerX, towerY, towerW, towerH);
  ctx.strokeRect(towerX, towerY, towerW, towerH);

  // Pitched Roof (#234c7a)
  ctx.fillStyle = '#234c7a';
  ctx.beginPath();
  ctx.moveTo(towerX - 12, towerY);
  ctx.lineTo(towerX + towerW / 2, towerY - 48);
  ctx.lineTo(towerX + towerW + 12, towerY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Clock Face (#dfc992)
  const clockCx = towerX + towerW / 2;
  const clockCy = towerY + 48;
  ctx.fillStyle = '#dfc992';
  ctx.beginPath();
  ctx.arc(clockCx, clockCy, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Animated Clock Hands
  ctx.beginPath();
  ctx.moveTo(clockCx, clockCy);
  ctx.lineTo(
    clockCx + Math.cos(time * 1.5) * 16,
    clockCy + Math.sin(time * 1.5) * 16
  );
  ctx.moveTo(clockCx, clockCy);
  ctx.lineTo(clockCx, clockCy - 12);
  ctx.stroke();

  // Windows
  ctx.fillStyle = '#48586b';
  ctx.fillRect(towerX + 24, towerY + 100, 28, 38);
  ctx.strokeRect(towerX + 24, towerY + 100, 28, 38);
  ctx.fillRect(towerX + towerW - 52, towerY + 100, 28, 38);
  ctx.strokeRect(towerX + towerW - 52, towerY + 100, 28, 38);
  ctx.restore();

  // SUBJECT 3 (Right): Moving Vintage Coupe Car (#50793e Matcha Green & #c6923a)
  ctx.save();
  const carX = width * 0.76 + Math.sin(time * 1.4) * 28;
  const carY = groundY + 14;
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;

  // Car Lower Body (#50793e)
  ctx.fillStyle = '#50793e';
  ctx.beginPath();
  ctx.roundRect(carX - 85, carY - 26, 170, 38, 10);
  ctx.fill();
  ctx.stroke();

  // Car Cabin (#729749)
  ctx.fillStyle = '#729749';
  ctx.beginPath();
  ctx.roundRect(carX - 46, carY - 54, 92, 30, 8);
  ctx.fill();
  ctx.stroke();

  // Windows (#bfd3db)
  ctx.fillStyle = '#bfd3db';
  ctx.fillRect(carX - 36, carY - 48, 32, 20);
  ctx.strokeRect(carX - 36, carY - 48, 32, 20);
  ctx.fillRect(carX + 4, carY - 48, 32, 20);
  ctx.strokeRect(carX + 4, carY - 48, 32, 20);

  // Warm Yellow Headlight (#fbf09c)
  ctx.fillStyle = '#fbf09c';
  ctx.beginPath();
  ctx.arc(carX - 80, carY - 10, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wheels (#1d1a16 & #ece5d3)
  for (const wx of [carX - 48, carX + 48]) {
    ctx.fillStyle = '#1d1a16';
    ctx.beginPath();
    ctx.arc(wx, carY + 14, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ece5d3';
    ctx.beginPath();
    ctx.arc(wx, carY + 14, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders the video frame + all active TimelineEditItems for the current timestamp.
 */
export function renderCompositedFrame(
  mainCtx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  currentTime: number,
  edits: TimelineEditItem[]
) {
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

      if (edit.annotations.length > 0) {
        const merged = mergeBoundingBoxes(edit.annotations.map((a) => a.bbox));
        focusX = 0.5 + (merged.cx - 0.5) * eased;
        focusY = 0.5 + (merged.cy - 0.5) * eased;
      }
    }

    if (edit.effectType === 'camera_fx' && edit.params.cameraEffect === 'shake') {
      const intensity = (edit.params.intensity ?? 0.8) * 12;
      shakeX = Math.sin(currentTime * 55) * intensity;
      shakeY = Math.cos(currentTime * 68) * intensity;
    }
  }

  mainCtx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
  mainCtx.scale(scale, scale);
  mainCtx.translate(-focusX * width, -focusY * height);

  mainCtx.drawImage(sourceCanvas, 0, 0, width, height);

  for (const edit of activeEdits) {
    const { effectType, params, annotations } = edit;

    if (effectType === 'blur') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');
      mainCtx.filter = `blur(${params.blurRadius ?? 16}px)`;
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.restore();
    }

    if (effectType === 'pixelate') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');

      const blockSize = Math.max(6, params.pixelBlockSize ?? 14);
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

    if (effectType === 'spotlight') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, true);
      mainCtx.clip('evenodd');
      mainCtx.fillStyle = `rgba(29, 26, 22, ${params.dimOpacity ?? 0.72})`;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

    if (effectType === 'neon_glow') {
      const glowColor = params.glowColor ?? '#b82d23';
      const pulseFactor = params.pulse ? 0.75 + 0.35 * Math.sin(currentTime * 8) : 1;

      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, false);
      mainCtx.shadowColor = glowColor;
      mainCtx.shadowBlur = (params.glowIntensity ?? 24) * pulseFactor;
      mainCtx.strokeStyle = glowColor;
      mainCtx.lineWidth = 4;
      mainCtx.stroke();

      mainCtx.clip();
      mainCtx.globalCompositeOperation = 'screen';
      mainCtx.fillStyle = glowColor;
      mainCtx.globalAlpha = 0.32 * pulseFactor;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

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
      mainCtx.shadowBlur = 8;
      mainCtx.lineWidth = 4;

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
        const bounce = Math.sin(currentTime * 9) * 10;
        const tipX = bbox.cx * width;
        const tipY = ry - 8 + bounce;
        mainCtx.fillStyle = color;
        mainCtx.beginPath();
        mainCtx.moveTo(tipX, tipY);
        mainCtx.lineTo(tipX - 16, tipY - 26);
        mainCtx.lineTo(tipX - 6, tipY - 26);
        mainCtx.lineTo(tipX - 6, tipY - 56);
        mainCtx.lineTo(tipX + 6, tipY - 56);
        mainCtx.lineTo(tipX + 6, tipY - 26);
        mainCtx.lineTo(tipX + 16, tipY - 26);
        mainCtx.closePath();
        ctx_fill_stroke(mainCtx);
      } else {
        mainCtx.setLineDash([14, 8]);
        mainCtx.lineDashOffset = -currentTime * 45;
        mainCtx.beginPath();
        mainCtx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2 + 8, rh / 2 + 8, 0, 0, Math.PI * 2);
        mainCtx.stroke();
      }
      mainCtx.restore();
    }

    if (effectType === 'text_overlay' && params.text) {
      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.25, y: 0.72, width: 0.5, height: 0.15, cx: 0.5, cy: 0.8 };

      const tx = bbox.cx * width;
      const ty = Math.max(42, bbox.y * height - 14);
      const fontSize = Math.round((params.fontSize ?? 30) * (width / 960));

      mainCtx.save();
      mainCtx.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
      mainCtx.textAlign = 'center';
      mainCtx.textBaseline = 'bottom';

      const metrics = mainCtx.measureText(params.text);
      const padX = 16;
      const padY = 8;

      // Framed Parchment Callout Card with Corner Dots
      mainCtx.fillStyle = '#ece5d3';
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 2.5;
      const boxX = tx - metrics.width / 2 - padX;
      const boxY = ty - fontSize - padY;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + padY * 2;
      mainCtx.fillRect(boxX, boxY, boxW, boxH);
      mainCtx.strokeRect(boxX, boxY, boxW, boxH);

      mainCtx.fillStyle = '#1d1a16';
      for (const [rx, ry] of [
        [boxX + 5, boxY + 5],
        [boxX + boxW - 5, boxY + 5],
        [boxX + 5, boxY + boxH - 5],
        [boxX + boxW - 5, boxY + boxH - 5],
      ]) {
        mainCtx.beginPath();
        mainCtx.arc(rx, ry, 2, 0, Math.PI * 2);
        mainCtx.fill();
      }

      mainCtx.fillStyle = '#1d1a16';
      mainCtx.fillText(params.text, tx, ty - 2);
      mainCtx.restore();
    }

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
        const offset = Math.sin(currentTime * 35) * 8;
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
}

function ctx_fill_stroke(ctx: CanvasRenderingContext2D) {
  ctx.fill();
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2;
  ctx.stroke();
}
