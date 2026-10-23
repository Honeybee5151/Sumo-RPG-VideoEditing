import {
  BoundingBox,
  COLOR_PROGRESSION,
  ColorGroupSummary,
  DrawingTool,
  MARK_COLORS,
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

  if (tool === 'dot') {
    const pt = points[points.length - 1];
    const rW = 0.05;
    const rH = 0.088;
    return {
      x: Math.max(0, Math.min(1 - rW * 2, pt.x - rW)),
      y: Math.max(0, Math.min(1 - rH * 2, pt.y - rH)),
      width: rW * 2,
      height: rH * 2,
      cx: pt.x,
      cy: pt.y,
    };
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
  const uniqueColors = Array.from(new Set(annotations.map((a) => a.color)));

  for (const color of uniqueColors) {
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
  availableColors: MarkColor[],
  preferredColor?: MarkColor | 'all'
): MarkColor | 'all' {
  if ( /\b(full\s*frame|entire\s*video|whole\s*screen|everywhere)\b/i.test(clause) ) {
    return 'all';
  }
  const lower = clause.toLowerCase();
  // 1. Check exact color ID or display name among placed colors
  for (const c of availableColors) {
    const cfgName = MARK_COLORS[c]?.name?.toLowerCase() || '';
    const baseHueWord = cfgName.replace(/#\d+/g, '').trim().split(/\s+/).pop() || '';
    if (
      new RegExp(`\\b${c.toLowerCase()}\\b`, 'i').test(lower) ||
      (cfgName && lower.includes(cfgName)) ||
      (baseHueWord.length >= 4 && new RegExp(`\\b${baseHueWord}\\b`, 'i').test(lower))
    ) {
      return c;
    }
  }
  if (preferredColor && preferredColor !== 'all' && availableColors.includes(preferredColor)) {
    return preferredColor;
  }
  if (availableColors.length === 1) {
    return availableColors[0];
  }
  for (const c of COLOR_PROGRESSION.slice(0, 32)) {
    const cfgName = MARK_COLORS[c]?.name?.toLowerCase() || '';
    if (
      new RegExp(`\\b${c}\\b`, 'i').test(lower) ||
      (cfgName && lower.includes(cfgName))
    ) {
      return c;
    }
  }
  return preferredColor && preferredColor !== 'all'
    ? preferredColor
    : availableColors[0] ?? 'all';
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
  aiProviderLabel = 'Built-in Semantic Compiler',
  preferredColor?: MarkColor | 'all'
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
    const targetColor = detectTargetColorInClause(clause, availableColors, preferredColor);
    const matchingAnnotations =
      targetColor === 'all'
        ? annotations
        : annotations.filter((a) => a.color === targetColor);

    // Optional inline time override in the clause (e.g. "from 1.5s to 4s" or "2s-5s")
    let clauseStart = startTime;
    let clauseEnd = endTime;
    const timeRangeMatch = lower.match(
      /(?:from\s+|at\s+|between\s+)?(\d+(?:\.\d+)?)\s*s?\s*(?:to|and|-|–)\s*(\d+(?:\.\d+)?)\s*s?/i
    );
    if (timeRangeMatch) {
      const t1 = parseFloat(timeRangeMatch[1]);
      const t2 = parseFloat(timeRangeMatch[2]);
      if (!Number.isNaN(t1) && !Number.isNaN(t2) && Math.abs(t2 - t1) >= 0.2) {
        clauseStart = Math.min(t1, t2);
        clauseEnd = Math.max(t1, t2);
      }
    } else if (matchingAnnotations.length > 0) {
      const annStarts = matchingAnnotations
        .map((a) => a.startTime)
        .filter((v): v is number => typeof v === 'number');
      const annEnds = matchingAnnotations
        .map((a) => a.endTime)
        .filter((v): v is number => typeof v === 'number');
      if (annStarts.length > 0 && annEnds.length > 0) {
        clauseStart = Math.min(...annStarts);
        clauseEnd = Math.max(...annEnds);
      }
    }

    const explicitFramesMatch = lower.match(/\bfor\s+(\d+)\s*frames?\b/i);
    if (explicitFramesMatch) {
      const frameCount = Math.max(1, parseInt(explicitFramesMatch[1], 10));
      clauseEnd = Number((clauseStart + frameCount / 30).toFixed(2));
    }

    const id = `edit-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
    const colorDisplay =
      targetColor !== 'all'
        ? MARK_COLORS[targetColor]?.name || targetColor.toUpperCase()
        : '';

    // 0. COMPOSITE RECIPE: ANIME IMPACT / DRAMATIC FOCUS
    if (/\b(anime\s+impact|dramatic\s+impact|action\s+impact|hero\s+moment)\b/i.test(lower)) {
      results.push(
        {
          id: `${id}-zoom`,
          prompt: clause,
          summary: 'Impact Zoom',
          startTime: clauseStart,
          endTime: clauseEnd,
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
          summary: 'RGB Split',
          startTime: clauseStart,
          endTime: clauseEnd,
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
          summary: 'Spotlight',
          startTime: clauseStart,
          endTime: clauseEnd,
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
        summary: 'Manga Ink',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: 'RGB Split',
        startTime: clauseStart,
        endTime: clauseEnd,
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

    // 3. GENERATIVE V2V / INPAINTING SYNTHESIS & OBJECT SPAWN
    if (
      /\b(replace|inpaint|regenerate|synthesize|v2v|hologram|fire|flames|watercolor|transform\s+into)\b/i.test(
        lower
      ) ||
      /\b(add|place|put|spawn|draw)\b.*\borange\b/i.test(lower) ||
      /\bcool\s+orange\b/i.test(lower)
    ) {
      const isCoolOrange =
        /\b(add|place|put|spawn|draw)\b.*\borange\b/i.test(lower) ||
        /\bcool\s+orange\b/i.test(lower);
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
        summary: isCoolOrange
          ? 'Cool Orange'
          : generativeStyle === 'fire'
          ? 'Fire Effect'
          : generativeStyle === 'hologram'
          ? 'Hologram Effect'
          : generativeStyle === 'watercolor'
          ? 'Watercolor Effect'
          : generativeStyle === 'cyber'
          ? 'Cyber Effect'
          : 'Gold Aura',
        startTime: clauseStart,
        endTime: clauseEnd,
        effectType: isCoolOrange ? 'custom_ai' : 'generative_replace',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          generativePrompt: clause,
          generativeStyle,
          ...(isCoolOrange ? { stickerObject: 'cool_orange' } : {}),
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
        summary: 'Zoom Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: 'Pixelate Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: 'Blur Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: 'Spotlight',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        targetColor !== 'all' ? MARK_COLORS[targetColor]?.hex || '#c6923a' : '#c6923a'
      );
      results.push({
        id,
        prompt: clause,
        summary: 'Glow Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: 'Text Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        targetColor !== 'all' ? MARK_COLORS[targetColor]?.hex || '#b82d23' : '#b82d23'
      );
      results.push({
        id,
        prompt: clause,
        summary:
          shapeType === 'arrow'
            ? 'Arrow Effect'
            : shapeType === 'brackets'
            ? 'Box Frame'
            : 'Ring Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        summary: isFreeze ? 'Freeze Frame' : isSlow ? 'Slow Motion' : 'Speed Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
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

    // 11.5. BOUNCE / JUMP / HOP EFFECT (Screen or Box Region)
    if (/\b(bounce|bouncing|jump|jumping|hop|hopping|boing)\b/i.test(lower)) {
      results.push({
        id,
        prompt: clause,
        summary: 'Bounce Effect',
        startTime: clauseStart,
        endTime: clauseEnd,
        effectType: 'custom_ai',
        targetColor,
        annotations: matchingAnnotations,
        params: {
          renderCode: `const phase = elapsed * 8.5;\nconst bounce = Math.abs(Math.sin(phase));\nconst offsetY = -bounce * 64 * scale;\nconst squash = 1 + Math.cos(phase * 2) * 0.045;\nctx.fillStyle = '#000000';\nctx.fillRect(0, 0, width, height);\nctx.save();\nctx.translate(width / 2, height / 2 + offsetY);\nctx.scale(1 / squash, squash);\nctx.translate(-width / 2, -height / 2);\nctx.drawImage(sourceCanvas, 0, 0, width, height);\nctx.restore();`,
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
        summary:
          cameraEffect === 'shake'
            ? 'Shake Effect'
            : cameraEffect === 'vhs_glitch'
            ? 'Glitch Effect'
            : cameraEffect === 'cinema_bars'
            ? 'Cinema Bars'
            : cameraEffect === 'flash'
            ? 'Flash Effect'
            : 'Vignette',
        startTime: clauseStart,
        endTime: clauseEnd,
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
        ? 'Black & White'
        : isInvert
        ? 'Invert Effect'
        : hasExplicitTint
        ? 'Color Tint'
        : 'Color Grade',
      startTime: clauseStart,
      endTime: clauseEnd,
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

/**
 * Condenses any verbose AI summary or user prompt into a crisp 1–2 word edit name
 * (e.g., "Bounce Effect", "Fire Effect", "Text Effect", "Sound 4", "Zoom Effect")
 * so edit labels never overflow or show ellipses across the UI.
 */
export function formatShortEditSummary(
  rawSummary?: string,
  prompt?: string,
  effectType?: string
): string {
  const combined = `${rawSummary || ''} ${prompt || ''}`.toLowerCase();

  if (/\b(bounce|bouncing|jump|jumping|hop|hopping|boing)\b/i.test(combined)) {
    return 'Bounce Effect';
  }
  if (/\b(fire|flames?|burning|burn|inferno|blaze)\b/i.test(combined)) {
    return 'Fire Effect';
  }
  if (/\b(water|waves?|splash|ripple|ocean|liquid)\b/i.test(combined)) {
    return 'Water Effect';
  }
  if (/\b(lightning|thunder|electric|shock|zap)\b/i.test(combined)) {
    return 'Lightning Effect';
  }
  if (/\b(snow|blizzard|frost|ice)\b/i.test(combined)) {
    return 'Snow Effect';
  }
  if (/\b(rain|storm|drizzle)\b/i.test(combined)) {
    return 'Rain Effect';
  }
  if (/\b(smoke|fog|mist|steam)\b/i.test(combined)) {
    return 'Smoke Effect';
  }
  if (/\b(spark|sparkles?|glitter|stars?)\b/i.test(combined)) {
    return 'Sparkle Effect';
  }
  if (/\b(explosion|explode|blast|boom)\b/i.test(combined)) {
    return 'Explosion Effect';
  }
  if (/\b(shake|earthquake|vibrate|tremor)\b/i.test(combined)) {
    return 'Shake Effect';
  }
  if (/\b(rgb\s*split|chromatic|aberration)\b/i.test(combined) || effectType === 'chromatic_aberration') {
    return 'RGB Split';
  }
  if (/\b(glitch|vhs)\b/i.test(combined)) {
    return 'Glitch Effect';
  }
  if (/\b(manga|halftone|ink|woodblock|sketch)\b/i.test(combined) || effectType === 'halftone_ink') {
    return 'Manga Ink';
  }
  if (/\b(blur|defocus|bokeh)\b/i.test(combined) || effectType === 'blur') {
    return 'Blur Effect';
  }
  if (/\b(pixel|pixelate|mosaic|censor|8-bit)\b/i.test(combined) || effectType === 'pixelate') {
    return 'Pixelate Effect';
  }
  if (/\b(spotlight|darken\s+background|dim\s+background)\b/i.test(combined) || effectType === 'spotlight') {
    return 'Spotlight';
  }
  if (/\b(neon|glow|aura|shine|radiate)\b/i.test(combined) || effectType === 'neon_glow') {
    return 'Glow Effect';
  }
  if (/\b(zoom|close\s*up|punch\s*in|magnify)\b/i.test(combined) || effectType === 'zoom') {
    return 'Zoom Effect';
  }
  if (/\b(spin|spinning|rotate|rotating|twirl|swirl|vortex)\b/i.test(combined)) {
    return 'Spin Effect';
  }
  if (/\b(pulse|pulsing|heartbeat|throb)\b/i.test(combined)) {
    return 'Pulse Effect';
  }
  if (/\b(wave|waving|wobble|warp|distort)\b/i.test(combined)) {
    return 'Wave Effect';
  }
  if (/\b(hologram|holo)\b/i.test(combined)) {
    return 'Hologram Effect';
  }
  if (/\b(black\s*&\s*white|black\s*and\s*white|grayscale|monochrome|b&w|noir)\b/i.test(combined)) {
    return 'Black & White';
  }
  if (/\b(invert|negative|x-ray)\b/i.test(combined)) {
    return 'Invert Effect';
  }
  if (/\b(freeze|pause\s+frame)\b/i.test(combined)) {
    return 'Freeze Frame';
  }
  if (/\b(slow|slomo|slow-mo)\b/i.test(combined)) {
    return 'Slow Motion';
  }
  if (/\b(fast|speed|timelapse)\b/i.test(combined) || effectType === 'speed') {
    return 'Speed Effect';
  }
  if (/\b(orange)\b/i.test(combined)) {
    return 'Orange Effect';
  }
  if (
    /\b(type|typing|text|caption|title|subtitle|write|say|label|quote)\b/i.test(combined) ||
    effectType === 'text_overlay'
  ) {
    return 'Text Effect';
  }
  if (/\b(sound|audio|recorded)\b/i.test(combined)) {
    const numMatch = combined.match(/sound\s*(\d+)/i);
    return numMatch ? `Sound ${numMatch[1]}` : 'Sound Effect';
  }

  // Fallback: clean rawSummary into a short 2-word title
  const base = (rawSummary || prompt || 'Custom Effect')
    .replace(/\s*[→@•].*$/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/^(?:added|created|applied|animated|ai\s+custom|custom)\s+/i, '')
    .replace(/\b(?:at|on|in|inside|around|across|over|with|to|for|of)\s+(?:the\s+)?(?:marked|selected|target|screen|video|frame|box|dot|position|region|area|interval).*$/i, '')
    .replace(/["']/g, '')
    .trim();

  const words = base.split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return 'AI Effect';
  const titled = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return titled.length > 16 ? titled.slice(0, 16).trim() : titled;
}
