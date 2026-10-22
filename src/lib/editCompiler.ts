import {
  BoundingBox,
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

  // If it's a single point or very thin brush stroke, give it sensible padding
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

export function summarizeColorGroups(annotations: ScreenAnnotation[]): ColorGroupSummary[] {
  const colors: MarkColor[] = ['red', 'blue', 'green', 'yellow'];
  const summaries: ColorGroupSummary[] = [];

  for (const color of colors) {
    const matching = annotations.filter((a) => a.color === color);
    if (matching.length > 0) {
      summaries.push({
        color,
        count: matching.length,
        combinedBbox: mergeBoundingBoxes(matching.map((m) => m.bbox)),
        tools: Array.from(new Set(matching.map((m) => m.tool))),
      });
    }
  }
  return summaries;
}

const COLOR_HEX_LOOKUP: Record<string, string> = {
  red: '#ef4444',
  crimson: '#dc2626',
  blue: '#3b82f6',
  cyan: '#06b6d4',
  aqua: '#06b6d4',
  green: '#10b981',
  emerald: '#10b981',
  lime: '#84cc16',
  yellow: '#eab308',
  gold: '#f59e0b',
  orange: '#f97316',
  purple: '#a855f7',
  violet: '#8b5cf6',
  pink: '#ec4899',
  magenta: '#d946ef',
  white: '#ffffff',
};

function detectTargetColorInClause(
  clause: string,
  availableColors: MarkColor[]
): MarkColor | 'all' {
  const lower = clause.toLowerCase();
  // Look for explicit "red area", "blue mark", "green box", "yellow circle", or standalone color references
  for (const c of ['red', 'blue', 'green', 'yellow'] as MarkColor[]) {
    const regex = new RegExp(
      `\\b${c}\\s*(area|region|zone|mark|marking|drawing|box|circle|spot|object|part|selection|stroke|arrow|line|one|target)?\\b`,
      'i'
    );
    if (regex.test(lower) && availableColors.includes(c)) {
      return c;
    }
  }
  for (const c of ['red', 'blue', 'green', 'yellow'] as MarkColor[]) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(lower)) {
      return c;
    }
  }
  // If user didn't name a color, but drew exactly one color on screen, bind to that drawn color!
  if (availableColors.length === 1) {
    return availableColors[0];
  }
  return availableColors[0] ?? 'all';
}

function extractTargetToneHex(clause: string, fallback = '#a855f7'): string {
  const lower = clause.toLowerCase();
  // Prefer color mentioned after "into", "to", "with", "glow", "neon", "tint"
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
 * one or more structured parametric TimelineEditItems for the [startTime, endTime] interval.
 */
export function compilePromptLocally(
  prompt: string,
  startTime: number,
  endTime: number,
  annotations: ScreenAnnotation[],
  aiProviderLabel = 'Smart Semantic Compiler'
): TimelineEditItem[] {
  const availableColors = Array.from(new Set(annotations.map((a) => a.color)));
  // Split compound prompts ("zoom into red and blur blue, then add text 'WOW' on green")
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

    // 1. ZOOM / PAN / FOCUS / CROP
    if (/\b(zoom|focus|close\s*up|punch\s*in|pan|crop|magnify|reframe)\b/i.test(lower)) {
      const isStrong = /\b(super|extreme|close|tight|2\.5x|3x|hard)\b/i.test(lower);
      const isInstant = /\b(instant|cut|punch|snap|jump)\b/i.test(lower);
      const scaleMatch = lower.match(/(\d+(?:\.\d+)?)\s*x/);
      const zoomScale = scaleMatch ? Math.min(3.5, Math.max(1.2, parseFloat(scaleMatch[1]))) : isStrong ? 2.3 : 1.75;

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

    // 2. PIXELATE / MOSAIC / CENSOR
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

    // 3. BLUR / DEFOCUS / BOKEH
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

    // 4. SPOTLIGHT / HIGHLIGHT / DARKEN BACKGROUND
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

    // 5. NEON / GLOW / AURA / CYBERPUNK OUTLINE
    if (/\b(neon|glow|aura|laser|electric|cyber|beam|shine|radiate)\b/i.test(lower)) {
      const glowColor = extractTargetToneHex(
        clause,
        targetColor !== 'all' ? COLOR_HEX_LOOKUP[targetColor] : '#a855f7'
      );
      results.push({
        id,
        prompt: clause,
        summary: `Neon Glow (${glowColor}) ${targetColor !== 'all' ? `on ${targetColor.toUpperCase()}` : ''}`,
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

    // 6. TEXT / CAPTION / SUBTITLE / LABEL OVERLAY
    if (/\b(text|caption|title|subtitle|write|say|label|word|quote)\b/i.test(lower) || /["']([^"']+)["']/.test(clause)) {
      const quoted = clause.match(/["']([^"']+)["']/);
      let extractedText = quoted ? quoted[1] : '';
      if (!extractedText) {
        const afterWord = clause.match(/(?:text|caption|title|label|write|say)\s+(.+)/i);
        extractedText = afterWord ? afterWord[1].replace(/^(?:as|to|saying)\s+/i, '').trim() : 'LOOK HERE!';
      }
      const isNeon = /\b(neon|glow)\b/i.test(lower);
      results.push({
        id,
        prompt: clause,
        summary: `Text "${extractedText}" ${targetColor !== 'all' ? `@ ${targetColor.toUpperCase()}` : ''}`,
        startTime,
        endTime,
        effectType: 'text_overlay',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          text: extractedText,
          textStyle: isNeon ? 'neon' : targetColor !== 'all' ? 'callout' : 'impact',
          textColor: '#ffffff',
          fontSize: 34,
        },
        enabled: true,
        aiProvider: aiProviderLabel,
      });
      return;
    }

    // 7. CALLOUT SHAPE / CIRCLE / BOX / ARROW / POINTER
    if (/\b(circle|ring|box|bracket|frame|outline|pointer|arrow|callout|target|highlight\s+box)\b/i.test(lower)) {
      const shapeType = /\b(bracket|box|frame|square)\b/i.test(lower)
        ? 'brackets'
        : /\b(arrow|point|pointer)\b/i.test(lower)
        ? 'arrow'
        : 'ring';
      const shapeColor = extractTargetToneHex(
        clause,
        targetColor !== 'all' ? COLOR_HEX_LOOKUP[targetColor] : '#ef4444'
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

    // 8. SPEED / SLOW-MO / FAST-FORWARD / FREEZE
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

    // 9. CAMERA FX (SHAKE / GLITCH / VHS / CINEMA BARS / VIGNETTE / FLASH)
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

    // 10. COLOR GRADING / B&W / SATURATION / HUE / INVERT / TINT (DEFAULT OR EXPLICIT)
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
