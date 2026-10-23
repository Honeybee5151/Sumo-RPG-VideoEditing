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

/**
 * Builds the comprehensive system prompt and project context so any AI model
 * (DeepSeek V3/R1, OpenAI GPT-4o, Google Gemini, Anthropic Claude, OpenRouter, Groq, xAI Grok, Mistral, or Local LLM)
 * fully understands how the ChromaCut video editor works and how to output exact edit operations.
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
    : 'All / Full Frame';

  const colorLines =
    colorSummary.length > 0
      ? colorSummary
          .map((c) => {
            const cfg = MARK_COLORS[c.color];
            const shapes = c.tools
              .map((t) => (t === 'dot' ? 'Dot (pinpoint)' : 'Box (rectangle)'))
              .join(' + ');
            const isSelected = focusedColorId === c.color ? ' [CURRENTLY SELECTED BY USER]' : '';
            return `- Color ID: "${c.color}" | Display Name: "${cfg?.name || c.color}" | Hex: ${cfg?.hex || '#b82d23'} | Shape: ${shapes} | Timeframe: [${c.startTime.toFixed(1)}s – ${c.endTime.toFixed(1)}s] | Normalized BBox: [x:${c.combinedBbox.x.toFixed(2)}, y:${c.combinedBbox.y.toFixed(2)}, w:${c.combinedBbox.width.toFixed(2)}, h:${c.combinedBbox.height.toFixed(2)}, center:(${c.combinedBbox.cx.toFixed(2)}, ${c.combinedBbox.cy.toFixed(2)})]${isSelected}`;
          })
          .join('\n')
      : '- No Boxes or Dots placed yet (apply edits to "all" / full frame).';

  const existingEditsLines =
    ctx.existingEdits && ctx.existingEdits.length > 0
      ? ctx.existingEdits
          .slice(-12)
          .map((e) => {
            const cName =
              e.targetColor && e.targetColor !== 'all'
                ? `${MARK_COLORS[e.targetColor]?.name || e.targetColor} ("${e.targetColor}")`
                : 'Full Frame ("all")';
            return `- [${e.startTime.toFixed(1)}s–${e.endTime.toFixed(1)}s] ${e.summary} (effectType: "${e.effectType}", targetColor: ${cName})`;
          })
          .join('\n')
      : '- None yet.';

  return `You are the AI Video Editing Engine inside ChromaCut Studio.

### HOW THIS APP WORKS (EDITOR ARCHITECTURE & CONTEXT)
1. **Spatial Highlighting (Boxes & Dots)**:
   - Users place colored **Boxes** (\`rect\` — rectangular regions) and **Dots** (\`dot\` — exact pinpoint targets) directly on the video canvas.
   - Coordinates are normalized \`[0.0, 1.0]\` where \`(0,0)\` is top-left and \`(1,1)\` is bottom-right.
   - Each placed Box or Dot has both an internal **Color ID** (e.g. \`"red"\`, \`"blue"\`, \`"c_12"\`) and a human-facing **Display Name** shown in the UI (e.g. \`"Crimson"\`, \`"Cobalt"\`, \`"Emerald"\`, \`"Amber"\`, \`"Vivid Tangerine #12"\`).
   - Always output the **Color ID** in \`"targetColor"\` (or \`"all"\` for full-frame effects). If the user refers to a color by its Display Name (like "Crimson" or "Cobalt") or does not mention a color name while a color is currently selected, target that color's ID.

2. **Temporal Interval & Playhead**:
   - Media File: \`${ctx.mediaFileName || 'Active Media'}\` (${ctx.mediaCategory || 'video'}), Total Duration: \`${(ctx.duration ?? 12).toFixed(1)}s\`, Red Playhead Position: \`${(ctx.currentTime ?? ctx.startTime).toFixed(1)}s\`.
   - Active Selected Timeframe (left of AI input): \`[${ctx.startTime.toFixed(2)}s, ${ctx.endTime.toFixed(2)}s]\`.
   - Currently Focused Color Badge (left of AI input): **${focusedColorName}** (${focusedColorId ? `Color ID: "${focusedColorId}"` : '"all"'}).
   - Unless the user specifies a different time window in their prompt (e.g., "from 1.5s to 4s"), use \`startTime: ${ctx.startTime.toFixed(2)}\` and \`endTime: ${ctx.endTime.toFixed(2)}\` (or the target color's own \`[startTime, endTime]\`).

3. **Placed Colors on the Video Canvas Right Now**:
${colorLines}

4. **Existing Edits Already on the Timeline**:
${existingEditsLines}
${
  ctx.customContextPrompt && ctx.customContextPrompt.trim()
    ? `\n5. **User's Custom Project Context / Instructions**:\n${ctx.customContextPrompt.trim()}\n`
    : ''
}
### ALLOWED \`effectType\` VALUES & PARAMETER SCHEMAS
Translate the user's natural-language prompt into a JSON array of 1 or more edit objects.
Each object can use one of these \`effectType\` values:
- \`"zoom"\`: Camera zoom/pan into target Box/Dot center (or screen center).
  \`params\`: \`{ "zoomScale": number (1.15 to 3.5, default 1.8), "zoomEasing": "smooth" | "instant" | "spring" }\`
- \`"blur"\`: Gaussian blur inside the Box/Dot (\`invertMask: false\`) or background bokeh blur outside the Box/Dot (\`invertMask: true\`).
  \`params\`: \`{ "blurRadius": number (6 to 36, default 18), "invertMask": boolean }\`
- \`"pixelate"\`: Mosaic censor blocks inside (\`invertMask: false\`) or outside (\`invertMask: true\`) the Box/Dot.
  \`params\`: \`{ "pixelBlockSize": number (8 to 28, default 14), "invertMask": boolean }\`
- \`"spotlight"\`: Darkens the surroundings outside the Box/Dot to spotlight the marked subject.
  \`params\`: \`{ "dimOpacity": number (0.4 to 0.9, default 0.72) }\`
- \`"color_grade"\`: Color grading, Black & White / Selective Color Splash (\`saturation: 0, invertMask: true\`), brightness/contrast, sepia, color inversion, or color tinting.
  \`params\`: \`{ "saturation"?: number (0 to 250, 0=B&W, 100=normal), "brightness"?: number (40 to 180, 100=normal), "contrast"?: number (50 to 200, 100=normal), "sepia"?: number (0 to 100), "invert"?: number (0 to 100), "hueRotate"?: number (0 to 360), "tintColor"?: string (hex e.g. "#b82d23"), "tintOpacity"?: number (0.15 to 0.8), "invertMask"?: boolean }\`
- \`"neon_glow"\`: Glowing aura outline/highlight around the Box/Dot.
  \`params\`: \`{ "glowColor": string (hex), "glowIntensity": number (12 to 40, default 24), "pulse": boolean }\`
- \`"halftone_ink"\`: Manga / comic halftone ink shader inside or outside the Box/Dot.
  \`params\`: \`{ "dotSpacing": number (4 to 12, default 6), "inkColor": string (hex, default "#1d1a16"), "paperColor": string (hex, default "#ece5d3"), "invertMask"?: boolean }\`
- \`"chromatic_aberration"\`: RGB channel split / 3D prism glitch.
  \`params\`: \`{ "aberrationOffset": number (4 to 18, default 10), "invertMask"?: boolean }\`
- \`"generative_replace"\`: Stylized AI V2V synthesis inside the Box/Dot.
  \`params\`: \`{ "generativePrompt": string, "generativeStyle": "fire" | "hologram" | "watercolor" | "cyber" | "gold_aura" }\`
- \`"text_overlay"\`: Text callout, label, title, or subtitle anchored to the Box/Dot or frame.
  \`params\`: \`{ "text": string, "textStyle": "impact" | "callout" | "neon" | "subtitle", "textColor": string (hex), "fontSize": number (20 to 52, default 32) }\`
- \`"callout_shape"\`: Animated HUD ring, corner brackets, or pointer arrow around the Box/Dot.
  \`params\`: \`{ "shapeType": "ring" | "brackets" | "arrow" | "box", "shapeColor": string (hex), "label"?: string }\`
- \`"speed"\`: Slow-motion, fast-forward, or freeze-frame over the interval.
  \`params\`: \`{ "playbackRate": number (0.25 to 4.0), "freezeFrame"?: boolean }\`
- \`"camera_fx"\`: Full-frame camera shake, VHS glitch, cinema letterbox bars, vignette, or flash.
  \`params\`: \`{ "cameraEffect": "shake" | "vignette" | "cinema_bars" | "vhs_glitch" | "flash", "intensity": number (0.2 to 1.0, default 0.8) }\`

### OPTIONAL TIMELINE CUT / SPLIT ACTIONS
If the user explicitly asks to cut, trim, or delete a section of the video timeline (e.g., "cut from 2s to 4s", "delete this interval", "split at 3.5s"), you may include an object in the JSON array with:
\`{ "action": "cut", "startTime": number, "endTime": number, "summary": "Cut 2.0s–4.0s" }\`
or \`{ "action": "split", "splitTime": number, "summary": "Split at 3.5s" }\`.

### OUTPUT FORMAT (STRICT JSON ARRAY ONLY)
Return ONLY a valid JSON array (no markdown explanation outside JSON). Each edit item must have:
[
  {
    "summary": "Short human-readable label (e.g. 'Zoom 2.0x → Crimson', 'Bokeh Blur → Cobalt')",
    "effectType": "zoom",
    "targetColor": "${focusedColorId || (colorSummary[0]?.color ?? 'all')}",
    "startTime": ${ctx.startTime.toFixed(2)},
    "endTime": ${ctx.endTime.toFixed(2)},
    "params": { ... }
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
    } else if (obj.effectType || obj.action) {
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

    const rawEffectType = String(item.effectType || 'color_grade').toLowerCase() as EffectType;
    const effectType: EffectType = VALID_EFFECT_TYPES.includes(rawEffectType)
      ? rawEffectType
      : 'color_grade';

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
    const itemEnd =
      typeof item.endTime === 'number' && !Number.isNaN(item.endTime) && item.endTime > itemStart + 0.1
        ? item.endTime
        : ctx.endTime;

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
          : `${effectType.replace('_', ' ')} → ${colorDisplay}`,
      startTime: itemStart,
      endTime: itemEnd,
      effectType,
      targetColor,
      annotations: matchingAnnotations,
      params:
        item.params && typeof item.params === 'object'
          ? (item.params as TimelineEditItem['params'])
          : {},
      enabled: true,
      aiProvider: providerLabel,
    });
  });

  return { edits, cutsToAdd, splitsToAdd };
}
