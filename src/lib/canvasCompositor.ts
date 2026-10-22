import { mergeBoundingBoxes } from '@/lib/editCompiler';
import { ScreenAnnotation, TimelineEditItem } from '@/types/editor';

/**
 * Builds a Canvas2D path for a list of ScreenAnnotations.
 * If invertMask is true, prepends a full-frame rectangle so clipping with 'evenodd'
 * affects everything OUTSIDE the user's drawn markings.
 */
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
      ctx.roundRect(x, y, w, h, 12);
    } else if (ann.tool === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (ann.tool === 'brush' && ann.points.length > 2) {
      // Expand brush stroke into a smooth closed region or padded bounding capsule
      // If the user scribbled a region, use the convex/bounding ellipse + stroke hull
      ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.35);
    } else {
      ctx.roundRect(x, y, w, h, 14);
    }
  }
}

/**
 * Renders the built-in procedural studio demo scene when no external video file is uploaded.
 * Features 4 distinct visual subjects so the user can immediately test multi-color interval edits.
 */
export function renderProceduralDemoScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
) {
  // 1. Twilight Cyberpunk / Studio Street Backdrop
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, '#0b1026');
  skyGrad.addColorStop(0.55, '#1b1638');
  skyGrad.addColorStop(1, '#121824');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle perspective grid floor
  const horizonY = height * 0.65;
  ctx.fillStyle = '#0d1322';
  ctx.fillRect(0, horizonY, width, height - horizonY);

  ctx.save();
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.22)';
  ctx.lineWidth = 1.5;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(width * 0.5 + i * 35, horizonY);
    ctx.lineTo(width * 0.5 + i * 160, height);
    ctx.stroke();
  }
  const gridOffset = (time * 40) % 28;
  for (let y = horizonY + gridOffset; y < height; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // City skyline silhouettes
  const buildings = [
    { x: 0.04, w: 0.12, h: 0.42 },
    { x: 0.17, w: 0.1, h: 0.34 },
    { x: 0.29, w: 0.14, h: 0.48 },
    { x: 0.46, w: 0.11, h: 0.36 },
    { x: 0.6, w: 0.15, h: 0.45 },
    { x: 0.77, w: 0.11, h: 0.38 },
    { x: 0.89, w: 0.09, h: 0.44 },
  ];
  for (const b of buildings) {
    ctx.fillStyle = '#131930';
    ctx.fillRect(b.x * width, horizonY - b.h * height, b.w * width, b.h * height);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.strokeRect(b.x * width, horizonY - b.h * height, b.w * width, b.h * height);
  }

  // SUBJECT 1 (Top-Left): Neon Arcade Billboard Sign
  ctx.save();
  const signX = width * 0.08;
  const signY = height * 0.16;
  const signW = width * 0.22;
  const signH = height * 0.22;
  ctx.fillStyle = '#1e1b4b';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(signX, signY, signW, signH, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f43f5e';
  ctx.font = `bold ${Math.round(width * 0.022)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('CYBER CAFE', signX + signW / 2, signY + signH * 0.45);
  ctx.fillStyle = '#38bdf8';
  ctx.font = `bold ${Math.round(width * 0.016)}px monospace`;
  ctx.fillText('OPEN 24/7 ★', signX + signW / 2, signY + signH * 0.74);
  ctx.restore();

  // SUBJECT 2 (Top-Right): Hovering Camera Drone
  ctx.save();
  const droneX = width * 0.76 + Math.sin(time * 1.8) * (width * 0.045);
  const droneY = height * 0.22 + Math.cos(time * 2.5) * (height * 0.03);
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.roundRect(droneX - 36, droneY - 14, 72, 28, 12);
  ctx.fill();
  // Rotors
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(droneX - 52, droneY - 18);
  ctx.lineTo(droneX - 18, droneY - 18);
  ctx.moveTo(droneX + 18, droneY - 18);
  ctx.lineTo(droneX + 52, droneY - 18);
  ctx.stroke();
  // Drone Eye
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(droneX, droneY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // SUBJECT 3 (Center): Animated Studio Robot / Skater Character
  ctx.save();
  const botX = width * 0.45 + Math.sin(time * 1.1) * (width * 0.03);
  const botY = height * 0.56;
  // Torso
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.roundRect(botX - 38, botY - 40, 76, 86, 16);
  ctx.fill();
  // Head
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(botX - 30, botY - 88, 60, 42, 12);
  ctx.fill();
  // Visor
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(botX - 22, botY - 78, 44, 20, 6);
  ctx.fill();
  // Glowing eyes
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.arc(botX - 10, botY - 68, 4, 0, Math.PI * 2);
  ctx.arc(botX + 10, botY - 68, 4, 0, Math.PI * 2);
  ctx.fill();
  // Chest badge
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(botX, botY - 4, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // SUBJECT 4 (Bottom-Right): Sports Car
  ctx.save();
  const carX = width * 0.74 + Math.cos(time * 0.9) * (width * 0.02);
  const carY = height * 0.72;
  // Car body
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.roundRect(carX - 95, carY - 26, 190, 44, 14);
  ctx.fill();
  // Cabin
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.roundRect(carX - 50, carY - 54, 100, 32, 10);
  ctx.fill();
  // Windshield
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.roundRect(carX - 42, carY - 48, 84, 22, 6);
  ctx.fill();
  // Headlights
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(carX - 88, carY - 6, 6, 0, Math.PI * 2);
  ctx.fill();
  // Wheels
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(carX - 55, carY + 18, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(carX + 55, carY + 18, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
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

  // 1. Calculate global camera transform (Zoom / Pan + Camera Shake)
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
      const rampTime = edit.params.zoomEasing === 'instant' ? 0.01 : Math.min(0.35, duration * 0.25);

      let progress = 1;
      if (elapsed < rampTime) {
        progress = elapsed / rampTime;
      } else if (remaining < rampTime) {
        progress = remaining / rampTime;
      }
      // Smoothstep easing
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

  // Apply camera transform
  mainCtx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
  mainCtx.scale(scale, scale);
  mainCtx.translate(-focusX * width, -focusY * height);

  // Draw base video frame
  mainCtx.drawImage(sourceCanvas, 0, 0, width, height);

  // 2. Apply Regional & Full-Frame Pixel Effects
  for (const edit of activeEdits) {
    const { effectType, params, annotations } = edit;

    // A. GAUSSIAN BLUR
    if (effectType === 'blur') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, Boolean(params.invertMask));
      mainCtx.clip(params.invertMask ? 'evenodd' : 'nonzero');
      mainCtx.filter = `blur(${params.blurRadius ?? 16}px)`;
      mainCtx.drawImage(sourceCanvas, 0, 0, width, height);
      mainCtx.restore();
    }

    // B. PIXELATE / MOSAIC
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

    // C. COLOR GRADING & TINTING
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

    // D. SPOTLIGHT (Dim Outside Marked Region)
    if (effectType === 'spotlight') {
      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, true);
      mainCtx.clip('evenodd');
      mainCtx.fillStyle = `rgba(5, 7, 15, ${params.dimOpacity ?? 0.72})`;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

    // E. NEON GLOW
    if (effectType === 'neon_glow') {
      const glowColor = params.glowColor ?? '#a855f7';
      const pulseFactor = params.pulse ? 0.75 + 0.35 * Math.sin(currentTime * 8) : 1;

      mainCtx.save();
      buildMaskPath(mainCtx, annotations, width, height, false);
      mainCtx.shadowColor = glowColor;
      mainCtx.shadowBlur = (params.glowIntensity ?? 24) * pulseFactor;
      mainCtx.strokeStyle = glowColor;
      mainCtx.lineWidth = 4;
      mainCtx.stroke();

      // Inner vibrant tint bloom
      mainCtx.clip();
      mainCtx.globalCompositeOperation = 'screen';
      mainCtx.fillStyle = glowColor;
      mainCtx.globalAlpha = 0.32 * pulseFactor;
      mainCtx.fillRect(0, 0, width, height);
      mainCtx.restore();
    }

    // F. CALLOUT SHAPE (Ring, Viewfinder Brackets, or Arrow)
    if (effectType === 'callout_shape') {
      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.35, y: 0.3, width: 0.3, height: 0.4, cx: 0.5, cy: 0.5 };

      const rx = bbox.x * width;
      const ry = bbox.y * height;
      const rw = bbox.width * width;
      const rh = bbox.height * height;
      const color = params.shapeColor ?? '#ef4444';

      mainCtx.save();
      mainCtx.strokeStyle = color;
      mainCtx.shadowColor = color;
      mainCtx.shadowBlur = 12;
      mainCtx.lineWidth = 3.5;

      if (params.shapeType === 'brackets') {
        const corner = Math.min(rw, rh) * 0.25;
        mainCtx.beginPath();
        // Top-left
        mainCtx.moveTo(rx, ry + corner);
        mainCtx.lineTo(rx, ry);
        mainCtx.lineTo(rx + corner, ry);
        // Top-right
        mainCtx.moveTo(rx + rw - corner, ry);
        mainCtx.lineTo(rx + rw, ry);
        mainCtx.lineTo(rx + rw, ry + corner);
        // Bottom-right
        mainCtx.moveTo(rx + rw, ry + rh - corner);
        mainCtx.lineTo(rx + rw, ry + rh);
        mainCtx.lineTo(rx + rw - corner, ry + rh);
        // Bottom-left
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
        mainCtx.fill();
      } else {
        // Rotating dashed ring
        mainCtx.setLineDash([14, 8]);
        mainCtx.lineDashOffset = -currentTime * 45;
        mainCtx.beginPath();
        mainCtx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2 + 8, rh / 2 + 8, 0, 0, Math.PI * 2);
        mainCtx.stroke();
      }
      mainCtx.restore();
    }

    // G. TEXT / CAPTION OVERLAY
    if (effectType === 'text_overlay' && params.text) {
      const bbox =
        annotations.length > 0
          ? mergeBoundingBoxes(annotations.map((a) => a.bbox))
          : { x: 0.25, y: 0.72, width: 0.5, height: 0.15, cx: 0.5, cy: 0.8 };

      const tx = bbox.cx * width;
      const ty = Math.max(42, bbox.y * height - 14);
      const fontSize = Math.round((params.fontSize ?? 32) * (width / 960));

      mainCtx.save();
      mainCtx.font = `800 ${fontSize}px sans-serif`;
      mainCtx.textAlign = 'center';
      mainCtx.textBaseline = 'bottom';

      const metrics = mainCtx.measureText(params.text);
      const padX = 16;
      const padY = 8;

      if (params.textStyle === 'callout') {
        mainCtx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        mainCtx.strokeStyle = params.textColor ?? '#38bdf8';
        mainCtx.lineWidth = 2;
        mainCtx.beginPath();
        mainCtx.roundRect(
          tx - metrics.width / 2 - padX,
          ty - fontSize - padY,
          metrics.width + padX * 2,
          fontSize + padY * 2,
          10
        );
        mainCtx.fill();
        mainCtx.stroke();
      } else if (params.textStyle === 'neon') {
        mainCtx.shadowColor = '#ec4899';
        mainCtx.shadowBlur = 18;
      } else {
        mainCtx.shadowColor = 'rgba(0,0,0,0.85)';
        mainCtx.shadowBlur = 10;
        mainCtx.lineWidth = 5;
        mainCtx.strokeStyle = '#000000';
        mainCtx.strokeText(params.text, tx, ty);
      }

      mainCtx.fillStyle = params.textColor ?? '#ffffff';
      mainCtx.fillText(params.text, tx, ty);
      mainCtx.restore();
    }

    // H. CAMERA FX (Vignette, Cinema Bars, VHS Glitch, Flash)
    if (effectType === 'camera_fx') {
      mainCtx.save();
      if (params.cameraEffect === 'cinema_bars') {
        const barH = height * 0.12;
        mainCtx.fillStyle = '#000000';
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
        radGrad.addColorStop(0, 'rgba(0,0,0,0)');
        radGrad.addColorStop(1, 'rgba(0,0,0,0.78)');
        mainCtx.fillStyle = radGrad;
        mainCtx.fillRect(0, 0, width, height);
      } else if (params.cameraEffect === 'vhs_glitch') {
        mainCtx.globalCompositeOperation = 'screen';
        mainCtx.globalAlpha = 0.45;
        const offset = Math.sin(currentTime * 35) * 8;
        mainCtx.drawImage(sourceCanvas, offset, 0, width, height);
        // Scanlines
        mainCtx.globalCompositeOperation = 'source-over';
        mainCtx.fillStyle = 'rgba(255,255,255,0.06)';
        for (let y = 0; y < height; y += 6) {
          mainCtx.fillRect(0, y, width, 2);
        }
      } else if (params.cameraEffect === 'flash') {
        const flashAlpha = Math.max(0, Math.sin(currentTime * 22) * 0.55);
        mainCtx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
        mainCtx.fillRect(0, 0, width, height);
      }
      mainCtx.restore();
    }
  }

  mainCtx.restore();
}
