import {
  BoundingBox,
  COLOR_PROGRESSION,
  ColorGroupSummary,
  DrawingTool,
  MarkColor,
  NormalizedPoint,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';

export function computeBoundingBox(
  points: NormalizedPoint[],
  tool: DrawingTool,
  strokePadding = 0.02
): BoundingBox {
  if (points.length === 0) {
    return { x: 0.25, y: 0.25, width: 0.5, height: 0.5, cx: 0.5, cy: 0.5 };
  }

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const pt of points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const pad = tool === 'brush' || points.length === 1 ? Math.max(strokePadding, 0.03) : 0.005;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(1, maxX + pad);
  maxY = Math.min(1, maxY + pad);

  const width = Math.max(0.04, maxX - minX);
  const height = Math.max(0.04, maxY - minY);

  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
}

export function mergeBoundingBoxes(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) {
    return { x: 0.2, y: 0.2, width: 0.6, height: 0.6, cx: 0.5, cy: 0.5 };
  }
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }

  const width = Math.max(0.04, maxX - minX);
  const height = Math.max(0.04, maxY - minY);
  return {
    x: minX,
    y: minY,
    width,
    height,
    cx: minX + width / 2,
    cy: minY + height / 2,
  };
}

export function lerpBoundingBox(a: BoundingBox, b: BoundingBox, t: number): BoundingBox {
  const clamped = Math.min(1, Math.max(0, t));
  // Smoothstep interpolation
  const s = clamped * clamped * (3 - 2 * clamped);
  const x = a.x + (b.x - a.x) * s;
  const y = a.y + (b.y - a.y) * s;
  const width = a.width + (b.width - a.width) * s;
  const height = a.height + (b.height - a.height) * s;
  return {
    x,
    y,
    width,
    height,
    cx: x + width / 2,
    cy: y + height / 2,
  };
}

/**
 * Evaluates time-interpolated annotations for a given timestamp inside [startTime, endTime].
 * Supports:
 * 1. Trajectory Arrow Vectors: If a color group includes a shape + an 'arrow' stroke, the shape translates along the arrow vector over [startTime, endTime].
 * 2. Multi-Keyframe Boxes: If a color has annotations drawn at distinct timestamps (|t2 - t1| >= 0.35s), smoothly interpolates between keyframes over time.
 */
export function getInterpolatedAnnotations(
  annotations: ScreenAnnotation[],
  currentTime: number,
  startTime: number,
  endTime: number
): ScreenAnnotation[] {
  if (annotations.length <= 1) return annotations;

  const duration = Math.max(0.1, endTime - startTime);
  const progress = Math.min(1, Math.max(0, (currentTime - startTime) / duration));

  // Case 1: Trajectory Arrow + Base Shape(s)
  const arrows = annotations.filter((a) => a.tool === 'arrow' && a.points.length >= 2);
  const nonArrows = annotations.filter((a) => a.tool !== 'arrow');

  if (arrows.length > 0 && nonArrows.length > 0) {
    const arrow = arrows[arrows.length - 1];
    const startPt = arrow.points[0];
    const endPt = arrow.points[arrow.points.length - 1];
    const dx = (endPt.x - startPt.x) * progress;
    const dy = (endPt.y - startPt.y) * progress;

    return nonArrows.map((ann) => {
      const nx = Math.min(1 - ann.bbox.width, Math.max(0, ann.bbox.x + dx));
      const ny = Math.min(1 - ann.bbox.height, Math.max(0, ann.bbox.y + dy));
      return {
        ...ann,
        bbox: {
          x: nx,
          y: ny,
          width: ann.bbox.width,
          height: ann.bbox.height,
          cx: nx + ann.bbox.width / 2,
          cy: ny + ann.bbox.height / 2,
        },
        points: ann.points.map((p) => ({
          x: Math.min(1, Math.max(0, p.x + dx)),
          y: Math.min(1, Math.max(0, p.y + dy)),
        })),
      };
    });
  }

  // Case 2: Temporal Keyframes (drawn at timestamps >= 0.35s apart)
  const sorted = [...annotations].sort((a, b) => a.createdAtTime - b.createdAtTime);
  const timeSpan = sorted[sorted.length - 1].createdAtTime - sorted[0].createdAtTime;

  if (timeSpan >= 0.35) {
    // Interpolate between first and last keyframe across the interval
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const interpBox = lerpBoundingBox(first.bbox, last.bbox, progress);
    const dx = interpBox.cx - first.bbox.cx;
    const dy = interpBox.cy - first.bbox.cy;
    return [
      {
        ...first,
        bbox: interpBox,
        points: first.points.map((p) => ({
          x: Math.min(1, Math.max(0, p.x + dx)),
          y: Math.min(1, Math.max(0, p.y + dy)),
        })),
      },
    ];
  }

  return annotations;
}

export function summarizeColorGroups(annotations: ScreenAnnotation[]): ColorGroupSummary[] {
  const summaries: ColorGroupSummary[] = [];

  for (const color of COLOR_PROGRESSION) {
    const matching = annotations.filter((a) => a.color === color);
    if (matching.length > 0) {
      const sorted = [...matching].sort((a, b) => a.createdAtTime - b.createdAtTime);
      const timeSpan =
        sorted.length > 1
          ? sorted[sorted.length - 1].createdAtTime - sorted[0].createdAtTime
          : 0;
      const hasArrow = matching.some((m) => m.tool === 'arrow');

      const startTimes = matching
        .map((m) => m.startTime)
        .filter((v): v is number => typeof v === 'number');
      const endTimes = matching
        .map((m) => m.endTime)
        .filter((v): v is number => typeof v === 'number');

      summaries.push({
        color,
        count: matching.length,
        combinedBbox: mergeBoundingBoxes(matching.map((m) => m.bbox)),
        tools: Array.from(new Set(matching.map((m) => m.tool))),
        isMotionTracked: timeSpan >= 0.35 || (hasArrow && matching.length > 1),
        startTime: startTimes.length > 0 ? Math.min(...startTimes) : 1.0,
        endTime: endTimes.length > 0 ? Math.max(...endTimes) : 6.0,
      });
    }
  }
  return summaries;
}

const COLOR_HEX_LOOKUP: Record<string, string> = {
  red: '#b82d23',
  crimson: '#a64147',
  vermilion: '#b82d23',
  blue: '#234c7a',
  indigo: '#234c7a',
  cyan: '#2b7a78',
  aqua: '#84adc4',
  green: '#50793e',
  matcha: '#50793e',
  emerald: '#27513b',
  sage: '#85b296',
  yellow: '#c6923a',
  gold: '#c6923a',
  ochre: '#9a6c24',
  orange: '#cc5a2b',
  purple: '#7a3b69',
  violet: '#7a3b69',
  pink: '#b84a69',
  white: '#f5f2e8',
};

function detectTargetColorInClause(
  clause: string,
  availableColors: MarkColor[]
): MarkColor | 'all' {
  const lower = clause.toLowerCase();
  for (const c of COLOR_PROGRESSION) {
    const regex = new RegExp(
      `\\b${c}\\s*(area|region|zone|mark|marking|drawing|box|circle|spot|object|part|selection|stroke|arrow|line|one|target|highlight)?\\b`,
      'i'
    );
    if (regex.test(lower) && availableColors.includes(c)) {
      return c;
    }
  }
  for (const c of COLOR_PROGRESSION) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(lower)) {
      return c;
    }
  }
  if (availableColors.length === 1) {
    return availableColors[0];
  }
  return availableColors[0] ?? 'all';
}

function extractTargetToneHex(clause: string, fallback = '#c6923a'): string {
  const lower = clause.toLowerCase();
  const afterKeyword = lower.match(/(?:into|to|with|glow|neon|tint|color)\s+([a-z]+)/i);
  if (afterKeyword && COLOR_HEX_LOOKUP[afterKeyword[1]]) {
    return COLOR_HEX_LOOKUP[afterKeyword[1]];
  }
  for (const [name, hex] of Object.entries(COLOR_HEX_LOOKUP)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) {
      return hex;
    }
  }
  return fallback;
}

/**
 * Compiles a natural-language user prompt + multi-color screen annotations into
 * one or more structured parametric or generative TimelineEditItems for [startTime, endTime].
 */
export function compilePromptLocally(
  prompt: string,
  startTime: number,
  endTime: number,
  annotations: ScreenAnnotation[],
  aiProviderLabel = 'Built-in Semantic Compiler'
): TimelineEditItem[] {
  const availableColors = Array.from(new Set(annotations.map((a) => a.color)));
  const rawClauses = prompt
    .split(/(?:,|;|\band\b|\bthen\b|\balso\b|\bwhile\b)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  const clauses = rawClauses.length > 0 ? rawClauses : [prompt.trim()];
  const results: TimelineEditItem[] = [];

  clauses.forEach((clause, idx) => {
    const lower = clause.toLowerCase();
    const targetColor = detectTargetColorInClause(clause, availableColors);
    const matchingAnnotations =
      targetColor === 'all'
        ? annotations
        : annotations.filter((a) => a.color === targetColor);

    const id = `edit-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;

    // 0. COMPOSITE RECIPE: ANIME IMPACT / DRAMATIC FOCUS
    if (/\b(anime\s+impact|dramatic\s+impact|action\s+impact|hero\s+moment)\b/i.test(lower)) {
      results.push(
        {
          id: `${id}-zoom`,
          prompt: clause,
          summary: `Impact Zoom 2.1x → ${targetColor !== 'all' ? targetColor.toUpperCase() : 'Center'}`,
          startTime,
          endTime,
          effectType: 'zoom',
          targetColor,
          annotations: matchingAnnotations,
          params: { zoomScale: 2.1, zoomEasing: 'smooth' },
          enabled: true,
          aiProvider: aiProviderLabel,
        },
        {
          id: `${id}-rgb`,
          prompt: clause,
          summary: `Chromatic RGB Split → ${targetColor !== 'all' ? targetColor.toUpperCase() : 'Frame'}`,
          startTime,
          endTime,
          effectType: 'chromatic_aberration',
          targetColor,
          annotations: matchingAnnotations,
          params: { aberrationOffset: 9, invertMask: false },
          enabled: true,
          aiProvider: aiProviderLabel,
        },
        {
          id: `${id}-spot`,
          prompt: clause,
          summary: `Dramatic Spotlight → ${targetColor !== 'all' ? targetColor.toUpperCase() : 'Center'}`,
          startTime,
          endTime,
          effectType: 'spotlight',
          targetColor,
          annotations: matchingAnnotations,
          params: { dimOpacity: 0.65 },
          enabled: true,
          aiProvider: aiProviderLabel,
        }
      );
      return;
    }

    // 1. HALFTONE / MANGA INK / WOODBLOCK SHADER
    if (/\b(manga|halftone|ink|comic|woodblock|stipple|sketch|ukiyo)\b/i.test(lower)) {
      const invertMask = /\b(outside|background|except|around)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Manga Halftone Ink ${invertMask ? '(Background) ' : ''}${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'halftone_ink',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          dotSpacing: 6,
          inkColor: '#1d1a16',
          paperColor: '#ece5d3',
          invertMask,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 2. CHROMATIC ABERRATION / RGB SPLIT / PRISM
    if (/\b(chromatic|aberration|rgb\s*split|3d\s*glitch|prism|color\s*fringe)\b/i.test(lower)) {
      const invertMask = /\b(outside|background|except|around)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Chromatic RGB Split ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : '(Full)'}`,
        startTime,
        endTime,
        effectType: 'chromatic_aberration',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          aberrationOffset: 10,
          invertMask,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 3. GENERATIVE V2V / INPAINTING SYNTHESIS
    if (/\b(replace|inpaint|regenerate|synthesize|v2v|hologram|fire|flames|watercolor|transform\s+into)\b/i.test(lower)) {
      const generativeStyle = /\b(fire|flame|burn)\b/i.test(lower)
        ? 'fire'
        : /\b(hologram|holo|sci-fi)\b/i.test(lower)
        ? 'hologram'
        : /\b(watercolor|paint)\b/i.test(lower)
        ? 'watercolor'
        : /\b(cyber|neon|matrix)\b/i.test(lower)
        ? 'cyber'
        : 'gold_aura';

      results.push({
        id,
        prompt: clause,
        summary: `AI V2V Inpaint (${generativeStyle.toUpperCase()}) ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'generative_replace',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          generativePrompt: clause,
          generativeStyle,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 4. ZOOM / PAN / FOCUS / CROP
    if (/\b(zoom|focus|close\s*up|punch\s*in|pan|crop|magnify|reframe)\b/i.test(lower)) {
      const isStrong = /\b(super|extreme|close|tight|2\.5x|3x|hard)\b/i.test(lower);
      const isInstant = /\b(instant|cut|punch|snap|jump)\b/i.test(lower);
      const scaleMatch = lower.match(/(\d+(?:\.\d+)?)\s*x/);
      const zoomScale = scaleMatch
        ? Math.min(3.5, Math.max(1.2, parseFloat(scaleMatch[1])))
        : isStrong
        ? 2.3
        : 1.75;

      results.push({
        id,
        prompt: clause,
        summary: `Zoom ${zoomScale.toFixed(1)}x ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()} mark` : 'in'}`,
        startTime,
        endTime,
        effectType: 'zoom',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          zoomScale,
          zoomEasing: isInstant ? 'instant' : 'smooth',
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 5. PIXELATE / MOSAIC / CENSOR
    if (/\b(pixel|pixelate|mosaic|censor|8-bit|blocky)\b/i.test(lower)) {
      const invertMask = /\b(outside|background|except|around)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Pixelate ${invertMask ? 'outside ' : ''}${targetColor !== 'all' ? `${targetColor.toUpperCase()} region` : 'frame'}`,
        startTime,
        endTime,
        effectType: 'pixelate',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          pixelBlockSize: 14,
          invertMask,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 6. BLUR / DEFOCUS / BOKEH
    if (/\b(blur|defocus|bokeh|obscure|hide|smooth|fog)\b/i.test(lower)) {
      const invertMask = /\b(outside|background|except|around|bokeh|portrait)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Gaussian Blur ${invertMask ? '(Background) ' : ''}${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : '(Full)'}`,
        startTime,
        endTime,
        effectType: 'blur',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          blurRadius: 18,
          invertMask,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 7. SPOTLIGHT / HIGHLIGHT / DARKEN BACKGROUND
    if (/\b(spotlight|darken\s+background|dim\s+background|isolate|focus\s+light)\b/i.test(lower)) {
      results.push({
        id,
        prompt: clause,
        summary: `Spotlight ${targetColor !== 'all' ? `${targetColor.toUpperCase()} region` : 'center'}`,
        startTime,
        endTime,
        effectType: 'spotlight',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          dimOpacity: 0.72,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 8. NEON / GLOW / AURA
    if (/\b(neon|glow|aura|laser|electric|cyber|beam|shine|radiate)\b/i.test(lower)) {
      const glowColor = extractTargetToneHex(
        clause,
        targetColor !== 'all' ? COLOR_HEX_LOOKUP[targetColor] : '#c6923a'
      );
      results.push({
        id,
        prompt: clause,
        summary: `Warm Glow (${glowColor}) ${targetColor !== 'all' ? `on ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'neon_glow',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          glowColor,
          glowIntensity: 24,
          pulse: true,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 9. TEXT / CAPTION / SUBTITLE / LABEL OVERLAY
    if (
      /\b(text|caption|title|subtitle|write|say|label|word|quote|plaque)\b/i.test(lower) ||
      /["']([^"']+)["']/.test(clause)
    ) {
      const quoted = clause.match(/["']([^"']+)["']/);
      let extractedText = quoted ? quoted[1] : '';
      if (!extractedText) {
        const afterWord = clause.match(/(?:text|caption|title|label|write|say|plaque)\s+(.+)/i);
        extractedText = afterWord
          ? afterWord[1].replace(/^(?:as|to|saying)\s+/i, '').trim()
          : 'LOOK HERE!';
      }
      const isNeon = /\b(neon|glow)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Callout "${extractedText}" ${targetColor !== 'all' ? `@ ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'text_overlay',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          text: extractedText,
          textStyle: isNeon ? 'neon' : targetColor !== 'all' ? 'callout' : 'impact',
          textColor: '#1d1a16',
          fontSize: 32,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 10. CALLOUT SHAPE / CIRCLE / BOX / ARROW / POINTER
    if (/\b(circle|ring|box|bracket|frame|outline|pointer|arrow|callout|target|highlight\s+box)\b/i.test(lower)) {
      const shapeType = /\b(bracket|box|frame|square)\b/i.test(lower)
        ? 'brackets'
        : /\b(arrow|point|pointer)\b/i.test(lower)
        ? 'arrow'
        : 'ring';
      const shapeColor = extractTargetToneHex(
        clause,
        targetColor !== 'all' ? COLOR_HEX_LOOKUP[targetColor] : '#b82d23'
      );
      results.push({
        id,
        prompt: clause,
        summary: `Animated ${shapeType} ${targetColor !== 'all' ? `@ ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'callout_shape',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          shapeType,
          shapeColor,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 11. SPEED / SLOW-MO / FAST-FORWARD / FREEZE
    if (/\b(slow|slomo|slow-mo|fast|speed|timelapse|freeze|pause|2x|0\.5x|half\s+speed|double\s+speed)\b/i.test(lower)) {
      const isFreeze = /\b(freeze|pause|stop|hold)\b/i.test(lower);
      const isSlow = /\b(slow|slomo|slow-mo|half|0\.5|0\.25)\b/i.test(lower);
      const numMatch = lower.match(/(\d+(?:\.\d+)?)\s*x/);
      const playbackRate = numMatch
        ? Math.min(4, Math.max(0.25, parseFloat(numMatch[1])))
        : isSlow
        ? 0.5
        : 2.0;

      results.push({
        id,
        prompt: clause,
        summary: isFreeze ? 'Freeze Frame' : `Playback Speed ${playbackRate}x`,
        startTime,
        endTime,
        effectType: 'speed',
        targetColor: 'all',
        annotations: [],
        params: {
          playbackRate,
          freezeFrame: isFreeze,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 12. CAMERA FX (SHAKE / GLITCH / VHS / CINEMA BARS / VIGNETTE / FLASH)
    if (/\b(shake|earthquake|vibrate|glitch|vhs|retro|cinema|letterbox|bars|vignette|flash|strobe)\b/i.test(lower)) {
      const cameraEffect = /\b(shake|earthquake|vibrate)\b/i.test(lower)
        ? 'shake'
        : /\b(glitch|vhs|retro)\b/i.test(lower)
        ? 'vhs_glitch'
        : /\b(cinema|letterbox|bars)\b/i.test(lower)
        ? 'cinema_bars'
        : /\b(flash|strobe)\b/i.test(lower)
        ? 'flash'
        : 'vignette';

      results.push({
        id,
        prompt: clause,
        summary: `Camera FX: ${cameraEffect.replace('_', ' ').toUpperCase()}`,
        startTime,
        endTime,
        effectType: 'camera_fx',
        targetColor: 'all',
        annotations: [],
        params: {
          cameraEffect,
          intensity: 0.8,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 13. COLOR GRADING / B&W / SATURATION / HUE / INVERT / TINT
    const isGrayscale = /\b(black\s*and\s*white|b&w|bw|grayscale|monochrome|desaturate|noir)\b/i.test(lower);
    const isInvert = /\b(invert|negative|x-ray|xray)\b/i.test(lower);
    const isSepia = /\b(sepia|vintage|old\s+film|warm)\b/i.test(lower);
    const isBright = /\b(bright|brighten|lighten|expose)\b/i.test(lower);
    const isDark = /\b(dark|darken|dim|shadow|moody)\b/i.test(lower);
    const isVibrant = /\b(vibrant|saturate|pop|vivid|colorful|boost)\b/i.test(lower);
    const invertMask = /\b(outside|background|except|rest|keep\s+only)\b/i.test(lower);

    const tintHex = extractTargetToneHex(clause, '');
    const hasExplicitTint =
      !isGrayscale &&
      !isInvert &&
      !isSepia &&
      /\b(turn|make|tint|color|paint|change|dye|shift)\b/i.test(lower) &&
      Boolean(tintHex);

    results.push({
      id,
      prompt: clause,
      summary: isGrayscale
        ? `Black & White ${invertMask ? '(Color Splash) ' : ''}${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : ''}`
        : isInvert
        ? `Invert Colors ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : ''}`
        : hasExplicitTint
        ? `Color Tint (${tintHex}) ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : ''}`
        : `Color Grade ${targetColor !== 'all' ? `→ ${targetColor.toUpperCase()}` : '(Interval)'}`,
      startTime,
      endTime,
      effectType: 'color_grade',
      targetColor,
      annotations: matchingAnnotations,
      params: {
        saturation: isGrayscale ? 0 : isVibrant ? 185 : 115,
        brightness: isBright ? 135 : isDark ? 65 : 105,
        contrast: isGrayscale || isVibrant ? 125 : 110,
        sepia: isSepia ? 80 : 0,
        invert: isInvert ? 100 : 0,
        hueRotate: 0,
        tintColor: hasExplicitTint ? tintHex : undefined,
        tintOpacity: hasExplicitTint ? 0.42 : undefined,
        invertMask,
      },
      enabled: true,
      aiProvider: aiProviderLabel,
    });
  });

  return results;
}
