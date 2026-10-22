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
 * Renders the Sumo Brothers RPG animated scene (matching the uploaded Sumo Brothers v0.0.11 screenshot
 * and Edo Washi color swatch sheet) when no custom video file is loaded.
 */
export function renderProceduralDemoScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
) {
  // 1. Washi Parchment Background (#ece5d3)
  ctx.fillStyle = '#ece5d3';
  ctx.fillRect(0, 0, width, height);

  // Subtle tatami / dojo horizon line
  const floorY = height * 0.84;
  ctx.fillStyle = '#d9ceb4';
  ctx.fillRect(0, floorY, width, height - floorY);
  ctx.strokeStyle = '#aba18c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(width, floorY);
  ctx.stroke();

  // Top Title "Sumo Brothers" & Version
  ctx.save();
  ctx.fillStyle = '#1d1a16';
  ctx.font = `600 ${Math.round(width * 0.038)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Sumo Brothers', width * 0.5, height * 0.11);

  ctx.fillStyle = '#544b43';
  ctx.font = `500 ${Math.round(width * 0.018)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('v0.0.11', width * 0.96, height * 0.07);
  ctx.restore();

  // SUBJECT 1 (Left): Matcha Dojo Banner (#50793e & #27513b)
  ctx.save();
  const bannerX = width * 0.11;
  const bannerY = height * 0.22 + Math.sin(time * 1.6) * 4;
  const bannerW = width * 0.15;
  const bannerH = height * 0.44;

  // Wood crossbar (#553726)
  ctx.fillStyle = '#553726';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;
  ctx.fillRect(bannerX - 12, bannerY - 8, bannerW + 24, 10);
  ctx.strokeRect(bannerX - 12, bannerY - 8, bannerW + 24, 10);

  // Matcha cloth (#50793e)
  ctx.fillStyle = '#50793e';
  ctx.beginPath();
  ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 4);
  ctx.fill();
  ctx.stroke();

  // Inner parchment crest (#ece5d3)
  ctx.fillStyle = '#ece5d3';
  ctx.beginPath();
  ctx.arc(bannerX + bannerW / 2, bannerY + bannerH * 0.36, bannerW * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#1d1a16';
  ctx.font = `bold ${Math.round(width * 0.024)}px serif`;
  ctx.textAlign = 'center';
  ctx.fillText('相撲', bannerX + bannerW / 2, bannerY + bannerH * 0.39);

  ctx.fillStyle = '#fbf09c';
  ctx.font = `bold ${Math.round(width * 0.014)}px sans-serif`;
  ctx.fillText('DOJO RANK', bannerX + bannerW / 2, bannerY + bannerH * 0.76);
  ctx.restore();

  // SUBJECT 2 (Center): Iconic Sumo Brothers Red Postbox + Sweeping Enso Brush Circle + Paper Plane
  const centerX = width * 0.48;
  const centerY = height * 0.53;

  // Sweeping Sumi Ink Enso Ring (#1d1a16)
  ctx.save();
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(centerX, centerY - 12, height * 0.31, 0.25 * Math.PI, 1.88 * Math.PI);
  ctx.stroke();

  // Animated Paper Airplane gliding along the Enso arc
  const planeAngle = -0.35 + Math.sin(time * 1.4) * 0.22;
  const planeRadius = height * 0.31;
  const planeX = centerX + Math.cos(planeAngle) * planeRadius;
  const planeY = centerY - 12 + Math.sin(planeAngle) * planeRadius;

  ctx.translate(planeX, planeY);
  ctx.rotate(planeAngle + Math.PI / 2);
  ctx.fillStyle = '#ece5d3';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-16, -11);
  ctx.lineTo(-9, 0);
  ctx.lineTo(-16, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-9, 0);
  ctx.stroke();
  ctx.restore();

  // Red Japanese Postbox (#b82d23)
  ctx.save();
  const boxW = width * 0.23;
  const boxH = height * 0.44;
  const boxX = centerX - boxW / 2;
  const boxY = height * 0.41;

  // Ground shadow
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.ellipse(centerX, boxY + boxH + 8, boxW * 0.82, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dome top
  ctx.fillStyle = '#b82d23';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(centerX, boxY, boxW * 0.48, height * 0.11, 0, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  // Postbox Body
  ctx.fillStyle = '#b82d23';
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  // Postbox Brim Collar
  ctx.beginPath();
  ctx.roundRect(boxX - 12, boxY - 6, boxW + 24, 18, 8);
  ctx.fill();
  ctx.stroke();

  // Postal Symbol 〒 on Dome
  ctx.strokeStyle = '#ece5d3';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(centerX - 16, boxY - 38);
  ctx.lineTo(centerX + 16, boxY - 38);
  ctx.moveTo(centerX - 16, boxY - 28);
  ctx.lineTo(centerX + 16, boxY - 28);
  ctx.moveTo(centerX, boxY - 28);
  ctx.lineTo(centerX, boxY - 12);
  ctx.stroke();

  // Mail Slot
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.roundRect(centerX - boxW * 0.28, boxY + 28, boxW * 0.56, 12, 4);
  ctx.fill();

  // Framed Parchment Menu Plaque with 4 Corner Rivets
  const plaqueW = boxW * 0.78;
  const plaqueH = boxH * 0.62;
  const plaqueX = centerX - plaqueW / 2;
  const plaqueY = boxY + 54;

  ctx.fillStyle = '#ece5d3';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 2;
  ctx.fillRect(plaqueX, plaqueY, plaqueW, plaqueH);
  ctx.strokeRect(plaqueX, plaqueY, plaqueW, plaqueH);

  // 4 Corner Rivet Dots
  const rivets = [
    [plaqueX + 6, plaqueY + 6],
    [plaqueX + plaqueW - 6, plaqueY + 6],
    [plaqueX + 6, plaqueY + plaqueH - 6],
    [plaqueX + plaqueW - 6, plaqueY + plaqueH - 6],
  ];
  ctx.fillStyle = '#1d1a16';
  for (const [rx, ry] of rivets) {
    ctx.beginPath();
    ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Menu Text Items inside Plaque
  ctx.font = `500 ${Math.round(width * 0.017)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#544b43';
  const menuItems = ['Singleplayer', 'Multiplayer', 'Options', 'Quit'];
  const activeMenuIdx = Math.floor(time * 1.2) % 4;
  menuItems.forEach((label, idx) => {
    const itemY = plaqueY + 32 + idx * 24;
    if (idx === activeMenuIdx) {
      ctx.fillStyle = '#1d1a16';
      ctx.font = `600 ${Math.round(width * 0.017)}px "Segoe UI", sans-serif`;
      // Triangle Pointer ▶
      ctx.beginPath();
      ctx.moveTo(plaqueX + 26, itemY - 11);
      ctx.lineTo(plaqueX + 35, itemY - 5);
      ctx.lineTo(plaqueX + 26, itemY + 1);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = '#544b43';
      ctx.font = `500 ${Math.round(width * 0.017)}px "Segoe UI", sans-serif`;
    }
    ctx.fillText(label, plaqueX + 44, itemY);
  });

  // Base Plinth
  ctx.fillStyle = '#1d1a16';
  ctx.fillRect(boxX - 6, boxY + boxH - 8, boxW + 12, 16);
  ctx.restore();

  // SUBJECT 3 (Right): Sumo Brother Rikishi Character (#234c7a Indigo Mawashi & #d4c098)
  ctx.save();
  const sumoX = width * 0.81;
  const sumoY = height * 0.58 + Math.abs(Math.sin(time * 2.4)) * -8;

  // Body
  ctx.fillStyle = '#d4c098';
  ctx.strokeStyle = '#1d1a16';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(sumoX, sumoY, 56, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Indigo Mawashi Belt (#234c7a)
  ctx.fillStyle = '#234c7a';
  ctx.beginPath();
  ctx.roundRect(sumoX - 52, sumoY + 4, 104, 30, 10);
  ctx.fill();
  ctx.stroke();

  // Gold Ochre Rope Knot (#c6923a)
  ctx.fillStyle = '#c6923a';
  ctx.beginPath();
  ctx.arc(sumoX, sumoY + 19, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Head
  ctx.fillStyle = '#d4c098';
  ctx.beginPath();
  ctx.arc(sumoX, sumoY - 66, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Chonmage Topknot (#1d1a16)
  ctx.fillStyle = '#1d1a16';
  ctx.beginPath();
  ctx.ellipse(sumoX, sumoY - 96, 12, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Determined Eyes
  ctx.fillRect(sumoX - 14, sumoY - 70, 8, 4);
  ctx.fillRect(sumoX + 6, sumoY - 70, 8, 4);
  // Red Cheek Blushes (#b82d23)
  ctx.fillStyle = '#b82d23';
  ctx.beginPath();
  ctx.arc(sumoX - 18, sumoY - 60, 4.5, 0, Math.PI * 2);
  ctx.arc(sumoX + 18, sumoY - 60, 4.5, 0, Math.PI * 2);
  ctx.fill();
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

      // Sumo Brothers Riveted Parchment Plaque Callout
      mainCtx.fillStyle = '#ece5d3';
      mainCtx.strokeStyle = '#1d1a16';
      mainCtx.lineWidth = 2.5;
      const boxX = tx - metrics.width / 2 - padX;
      const boxY = ty - fontSize - padY;
      const boxW = metrics.width + padX * 2;
      const boxH = fontSize + padY * 2;
      mainCtx.fillRect(boxX, boxY, boxW, boxH);
      mainCtx.strokeRect(boxX, boxY, boxW, boxH);

      // Corner rivets
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
