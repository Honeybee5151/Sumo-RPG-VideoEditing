import { summarizeColorGroups } from '@/lib/editCompiler';
import {
  EffectType,
  MARK_COLORS,
  MarkColor,
  ScreenAnnotation,
  TimelineEditItem,
  resolveColorId,
} from '@/types/editor';

export interface AiEditorContextInput {
  prompt: string;
  startTime: number;
  endTime: number;
  currentTime?: number;
  duration?: number;
  focusedColor?: MarkColor | 'all';
  annotations: ScreenAnnotation[];
  allAnnotations?: ScreenAnnotation[];
  existingEdits?: Array<{
    id: string;
    summary: string;
    effectType: EffectType;
    targetColor?: MarkColor | 'all';
    startTime: number;
    endTime: number;
  }>;
  splitPoints?: number[];
  cuts?: Array<{ startTime: number; endTime: number }>;
  mediaFileName?: string;
  mediaCategory?: 'video' | 'image' | 'audio';
  customContextPrompt?: string;
}

const VALID_EFFECT_TYPES: EffectType[] = [
  'custom_ai',
  'zoom',
  'blur',
  'pixelate',
  'spotlight',
  'color_grade',
  'neon_glow',
  'halftone_ink',
  'chromatic_aberration',
  'generative_replace',
  'text_overlay',
  'callout_shape',
  'speed',
  'camera_fx',
];

const DEFAULT_FPS = 30;

/**
 * Builds a clean, minimal system prompt providing ONLY the spatial position(s)
 * and the timeframe context so the AI can freely execute whatever the user asks
 * using direct HTML5 Canvas 2D code (`renderCode`) and/or SVG (`svg`).
 */
export function buildAiEditorSystemPrompt(ctx: AiEditorContextInput): string {
  const allAnns =
    ctx.allAnnotations && ctx.allAnnotations.length > 0
      ? ctx.allAnnotations
      : ctx.annotations;
  const colorSummary = summarizeColorGroups(allAnns);
  const focusedColorId =
    ctx.focusedColor && ctx.focusedColor !== 'all' ? ctx.focusedColor : null;
  const focusedColorName = focusedColorId
    ? MARK_COLORS[focusedColorId]?.name || focusedColorId
    : 'Full Frame';

  const activeDurationSec = Math.max(0.1, ctx.endTime - ctx.startTime);
  const activeFrameCount = Math.round(activeDurationSec * DEFAULT_FPS);

  const positionLines =
    colorSummary.length > 0
      ? colorSummary
          .map((c) => {
            const cfg = MARK_COLORS[c.color];
            const kind = c.tools.every((t) => t === 'dot') ? 'Dot (point)' : 'Box (region)';
            const isSelected = focusedColorId === c.color ? ' [ACTIVE TARGET]' : '';
            const cDuration = Math.max(0.1, c.endTime - c.startTime);
            const cFrames = Math.round(cDuration * DEFAULT_FPS);
            return `- targetColor: "${c.color}" (${cfg?.name || c.color}) | Type: ${kind} | Center: (cx: ${c.combinedBbox.cx.toFixed(3)}, cy: ${c.combinedBbox.cy.toFixed(3)}) | Box: [x: ${c.combinedBbox.x.toFixed(3)}, y: ${c.combinedBbox.y.toFixed(3)}, w: ${c.combinedBbox.width.toFixed(3)}, h: ${c.combinedBbox.height.toFixed(3)}] | Timeframe: ${c.startTime.toFixed(2)}s to ${c.endTime.toFixed(2)}s (${cFrames} frames @ 30fps)${isSelected}`;
          })
          .join('\n')
      : `- targetColor: "all" (Full Frame) | Center: (cx: 0.500, cy: 0.500) | Box: [x: 0.000, y: 0.000, w: 1.000, h: 1.000] | Timeframe: ${ctx.startTime.toFixed(2)}s to ${ctx.endTime.toFixed(2)}s (${activeFrameCount} frames @ 30fps)`;

  return `You are an AI inside a video editor. You are given a spatial position on the video canvas and a timeframe, and the user asks you to do something at that position during that timeframe.

### CONTEXT
1. **Selected Timeframe**:
   - Start: \`${ctx.startTime.toFixed(2)}s\`
   - End: \`${ctx.endTime.toFixed(2)}s\`
   - Duration: \`${activeDurationSec.toFixed(2)}s\` (**${activeFrameCount} frames** at 30 fps; 1 frame = 1/30s)
   - Current Playhead: \`${(ctx.currentTime ?? ctx.startTime).toFixed(2)}s\`, Total Video Duration: \`${(ctx.duration ?? 12).toFixed(2)}s\`
   - Focused Target: **${focusedColorName}** (\`"${focusedColorId || (colorSummary[0]?.color ?? 'all')}"\`)

2. **Marked Position(s) on the Video Canvas** (normalized \`0.0\` to \`1.0\`, where \`(0,0)\` is top-left and \`(1,1)\` is bottom-right):
${positionLines}
${
  ctx.customContextPrompt && ctx.customContextPrompt.trim()
    ? `\n3. **Additional Context**:\n${ctx.customContextPrompt.trim()}\n`
    : ''
}
### HOW TO DO WHAT THE USER ASKS
Do whatever the user asks at the target position and timeframe by returning a JSON array with an object containing:
- \`"summary"\`: Brief label describing what you did.
- \`"targetColor"\`: The target position's \`targetColor\` ID (e.g. \`"${focusedColorId || (colorSummary[0]?.color ?? 'all')}"\`).
- \`"startTime"\`: Start time in seconds (default \`${ctx.startTime.toFixed(2)}\`).
- \`"endTime"\`: End time in seconds (default \`${ctx.endTime.toFixed(2)}\`, or \`startTime + frames / 30\` if the user specifies a frame count).
- \`"renderCode"\` (string, optional): JavaScript code body executed every frame on the HTML5 2D Canvas during \`[startTime, endTime]\`.
  Your \`renderCode\` runs inside \`function(ctx, env) { ... }\` where both \`ctx\` and all properties of \`env\` are directly in scope:
  - \`ctx\`: \`CanvasRenderingContext2D\` of the output video canvas
  - \`sourceCanvas\`: \`HTMLCanvasElement\` containing the unedited video frame (use \`ctx.drawImage(sourceCanvas, ...)\` if you want to manipulate, zoom, filter, blur, or sample pixels from the video itself)
  - \`cx\`, \`cy\`: Target position center in pixels on the canvas
  - \`x\`, \`y\`, \`w\`, \`h\`: Target region top-left and width/height in pixels
  - \`r\`: Target radius in pixels at that position
  - \`width\`, \`height\`: Full canvas width and height in pixels
  - \`scale\`: Resolution scale factor (\`width / 960\`)
  - \`t\`: Current video timestamp in seconds
  - \`elapsed\`: Seconds elapsed since \`startTime\` (\`t - startTime\`)
  - \`duration\`: Total seconds in \`[startTime, endTime]\`
  - \`progress\`: \`0.0\` to \`1.0\` progress through the timeframe
  - \`frame\`: Current frame number within the timeframe (\`0\` to \`totalFrames\`)
  - \`totalFrames\`: Total frames in the timeframe (\`Math.round(duration * 30)\`)
- \`"svg"\` (string, optional): A complete \`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">...</svg>\` illustration to render centered at \`(cx, cy)\`. You can provide \`renderCode\`, \`svg\`, or both.

### OUTPUT FORMAT (STRICT JSON ARRAY ONLY)
Return ONLY a valid JSON array:
[
  {
    "summary": "...",
    "targetColor": "${focusedColorId || (colorSummary[0]?.color ?? 'all')}",
    "startTime": ${ctx.startTime.toFixed(2)},
    "endTime": ${ctx.endTime.toFixed(2)},
    "renderCode": "...",
    "svg": "..."
  }
]`;
}

export interface ParsedAiResponseResult {
  edits: TimelineEditItem[];
  cutsToAdd: Array<{ startTime: number; endTime: number }>;
  splitsToAdd: number[];
}

/**
 * Parses raw LLM text (handling DeepSeek R1 <think> blocks, markdown fences, or object wrappers)
 * into validated TimelineEditItem[] + optional timeline cuts/splits.
 */
export function parseAiEditResponse(
  rawText: string,
  ctx: AiEditorContextInput,
  providerLabel: string
): ParsedAiResponseResult {
  // 1. Strip DeepSeek R1 <think>...</think> reasoning blocks if present
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Strip markdown code fences ```json ... ```
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // 3. Extract JSON array or JSON object
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      parsed = JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
    } else {
      const objStart = cleaned.indexOf('{');
      const objEnd = cleaned.lastIndexOf('}');
      if (objStart !== -1 && objEnd > objStart) {
        parsed = JSON.parse(cleaned.slice(objStart, objEnd + 1));
      } else {
        throw new Error('No valid JSON found in AI response');
      }
    }
  }

  let rawItems: Array<Record<string, unknown>> = [];
  if (Array.isArray(parsed)) {
    rawItems = parsed as Array<Record<string, unknown>>;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.edits)) {
      rawItems = obj.edits as Array<Record<string, unknown>>;
    } else if (Array.isArray(obj.operations)) {
      rawItems = obj.operations as Array<Record<string, unknown>>;
    } else if (Array.isArray(obj.items)) {
      rawItems = obj.items as Array<Record<string, unknown>>;
    } else if (
      obj.renderCode ||
      obj.code ||
      obj.svg ||
      obj.customSvg ||
      obj.summary ||
      obj.effectType ||
      obj.action
    ) {
      rawItems = [obj];
    }
  }

  const allAnns =
    ctx.allAnnotations && ctx.allAnnotations.length > 0
      ? ctx.allAnnotations
      : ctx.annotations;
  const placedColors = Array.from(new Set(allAnns.map((a) => a.color)));
  const defaultFallbackColor: MarkColor | 'all' =
    ctx.focusedColor && ctx.focusedColor !== 'all'
      ? ctx.focusedColor
      : placedColors.length === 1
      ? placedColors[0]
      : 'all';

  const edits: TimelineEditItem[] = [];
  const cutsToAdd: Array<{ startTime: number; endTime: number }> = [];
  const splitsToAdd: number[] = [];

  rawItems.forEach((item, idx) => {
    const action = typeof item.action === 'string' ? item.action.toLowerCase() : '';
    if (action === 'cut' || action === 'delete' || item.effectType === 'cut') {
      const s =
        typeof item.startTime === 'number' ? item.startTime : ctx.startTime;
      const e = typeof item.endTime === 'number' ? item.endTime : ctx.endTime;
      if (e > s + 0.05) {
        cutsToAdd.push({ startTime: s, endTime: e });
      }
      return;
    }
    if (action === 'split' || item.effectType === 'split') {
      const st =
        typeof item.splitTime === 'number'
          ? item.splitTime
          : typeof item.startTime === 'number'
          ? item.startTime
          : ctx.currentTime ?? ctx.startTime;
      splitsToAdd.push(st);
      return;
    }

    const rawParams: Record<string, unknown> =
      item.params && typeof item.params === 'object'
        ? { ...(item.params as Record<string, unknown>) }
        : {};

    // Normalize top-level renderCode / svg / open-ended AI fields
    const codeCandidate =
      item.renderCode ??
      item.code ??
      item.canvasCode ??
      rawParams.renderCode ??
      rawParams.code ??
      rawParams.canvasCode;
    if (typeof codeCandidate === 'string' && codeCandidate.trim()) {
      rawParams.renderCode = codeCandidate.trim();
    }

    if (typeof item.customSvg === 'string' && !rawParams.customSvg) {
      rawParams.customSvg = item.customSvg;
    } else if (typeof item.svg === 'string' && !rawParams.customSvg) {
      rawParams.customSvg = item.svg;
    } else if (typeof rawParams.svg === 'string' && !rawParams.customSvg) {
      rawParams.customSvg = rawParams.svg;
    }
    if (item.customAnimation && typeof item.customAnimation === 'object' && !rawParams.customAnimation) {
      rawParams.customAnimation = item.customAnimation;
    }
    if (item.customParticles && typeof item.customParticles === 'object' && !rawParams.customParticles) {
      rawParams.customParticles = item.customParticles;
    }
    if (Array.isArray(item.customDrawCommands) && !rawParams.customDrawCommands) {
      rawParams.customDrawCommands = item.customDrawCommands;
    }
    if (typeof item.customCssFilter === 'string' && !rawParams.customCssFilter) {
      rawParams.customCssFilter = item.customCssFilter;
    }

    const hasOpenEndedAiPayload = Boolean(
      rawParams.customSvg ||
        rawParams.customParticles ||
        rawParams.customDrawCommands ||
        rawParams.customCssFilter ||
        rawParams.customOverlayGradient
    );

    const rawEffectType = String(
      item.effectType || (hasOpenEndedAiPayload ? 'custom_ai' : 'custom_ai')
    ).toLowerCase() as EffectType;

    let effectType: EffectType = VALID_EFFECT_TYPES.includes(rawEffectType)
      ? rawEffectType
      : 'custom_ai';

    // Guard against an LLM accidentally picking neon_glow when the user didn't ask for neon/glow
    const userAskedForGlow = /\b(neon|glow|glowing|aura|laser|outline\s+glow)\b/i.test(ctx.prompt);
    if (effectType === 'neon_glow' && !userAskedForGlow) {
      effectType = 'custom_ai';
    }

    const targetColor = resolveColorId(
      typeof item.targetColor === 'string' ? item.targetColor : undefined,
      placedColors,
      defaultFallbackColor
    );

    const matchingAnnotations =
      targetColor === 'all'
        ? allAnns
        : allAnns.filter((a) => a.color === targetColor);

    const itemStart =
      typeof item.startTime === 'number' && !Number.isNaN(item.startTime)
        ? Math.max(0, item.startTime)
        : ctx.startTime;
    let itemEnd =
      typeof item.endTime === 'number' && !Number.isNaN(item.endTime) && item.endTime > itemStart + 0.05
        ? item.endTime
        : ctx.endTime;

    // If the user explicitly specified a number of frames (e.g. "for 45 frames"), honor that exact frame count
    const explicitFramesMatch = ctx.prompt.match(/\bfor\s+(\d+)\s*frames?\b/i);
    if (explicitFramesMatch) {
      const frameCount = Math.max(1, parseInt(explicitFramesMatch[1], 10));
      itemEnd = Number((itemStart + frameCount / DEFAULT_FPS).toFixed(2));
    }

    const colorDisplay =
      targetColor !== 'all'
        ? MARK_COLORS[targetColor]?.name || targetColor
        : 'Full Frame';

    edits.push({
      id: `ai-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      prompt: ctx.prompt,
      summary:
        typeof item.summary === 'string' && item.summary.trim()
          ? item.summary.trim()
          : `${effectType === 'custom_ai' ? 'AI Custom Visual' : effectType.replace('_', ' ')} → ${colorDisplay}`,
      startTime: itemStart,
      endTime: itemEnd,
      effectType,
      targetColor,
      annotations: matchingAnnotations,
      params: rawParams as TimelineEditItem['params'],
      enabled: true,
      aiProvider: providerLabel,
    });
  });

  return { edits, cutsToAdd, splitsToAdd };
}
