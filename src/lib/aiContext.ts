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
 * Builds the comprehensive system prompt and project context so any AI model
 * (DeepSeek V3/R1, OpenAI GPT-4o, Google Gemini, Anthropic Claude, OpenRouter, Groq, xAI Grok, Mistral, or Local LLM)
 * can unleash its full open-ended creative, vector SVG, procedural animation, particle, and shader capabilities.
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

  const activeDurationSec = Math.max(0.1, ctx.endTime - ctx.startTime);
  const activeFrameCount = Math.round(activeDurationSec * DEFAULT_FPS);

  const colorLines =
    colorSummary.length > 0
      ? colorSummary
          .map((c) => {
            const cfg = MARK_COLORS[c.color];
            const shapes = c.tools
              .map((t) => (t === 'dot' ? 'Dot (pinpoint)' : 'Box (rectangle)'))
              .join(' + ');
            const isSelected = focusedColorId === c.color ? ' [CURRENTLY SELECTED BY USER]' : '';
            const cFrames = Math.round(Math.max(0.1, c.endTime - c.startTime) * DEFAULT_FPS);
            return `- Color ID: "${c.color}" | Display Name: "${cfg?.name || c.color}" | Hex: ${cfg?.hex || '#b82d23'} | Shape: ${shapes} | Timeframe: [${c.startTime.toFixed(2)}s – ${c.endTime.toFixed(2)}s] (${cFrames} frames @ 30fps) | Normalized Position/BBox: [x:${c.combinedBbox.x.toFixed(2)}, y:${c.combinedBbox.y.toFixed(2)}, w:${c.combinedBbox.width.toFixed(2)}, h:${c.combinedBbox.height.toFixed(2)}, center:(${c.combinedBbox.cx.toFixed(2)}, ${c.combinedBbox.cy.toFixed(2)})]${isSelected}`;
          })
          .join('\n')
      : '- No Boxes or Dots placed yet (apply edits to "all" / full frame, centered at (0.5, 0.5)).';

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

  return `You are the Open-Ended AI Video Editing & Visual Generation Engine inside Sumo VideoEditor.
You are NOT restricted to a small list of canned presets — you can generate ANY custom vector artwork (\`customSvg\`), custom animations (\`customAnimation\`), custom particle emitters (\`customParticles\`), custom procedural canvas drawings (\`customDrawCommands\`), and custom CSS/shader filters (\`customCssFilter\`) at any marked position on the video!

### 1. SPATIAL HIGHLIGHTING (BOXES & DOTS) & TIMELINE CONTEXT
- Users place colored **Boxes** (\`rect\` — rectangular regions) and **Dots** (\`dot\` — pinpoint coordinate markers) on the video canvas.
- Coordinates are normalized \`[0.0, 1.0]\` where \`(0,0)\` is top-left and \`(1,1)\` is bottom-right.
- Each placed Box or Dot has an internal **Color ID** (e.g. \`"red"\`, \`"blue"\`, \`"c_12"\`) and a human **Display Name** (e.g. \`"Crimson"\`, \`"Cobalt"\`). Always output the internal **Color ID** in \`"targetColor"\` (or \`"all"\` for full-frame).
- Media File: \`${ctx.mediaFileName || 'Active Media'}\` (${ctx.mediaCategory || 'video'}), Total Duration: \`${(ctx.duration ?? 12).toFixed(2)}s\`, Frame Rate: \`30 fps\` (\`1 frame = 0.0333s\`), Red Playhead Position: \`${(ctx.currentTime ?? ctx.startTime).toFixed(2)}s\`.
- Active Selected Timeframe (shown in the UI): \`[${ctx.startTime.toFixed(2)}s, ${ctx.endTime.toFixed(2)}s]\` = **${activeFrameCount} frames** (${activeDurationSec.toFixed(2)}s).
- Currently Focused Color Target: **${focusedColorName}** (${focusedColorId ? `Color ID: "${focusedColorId}"` : '"all"'}).
- **Frame & Duration Rule**:
  - If the user says *"for the number of frames it says"*, *"for this timeframe"*, or does not specify a custom duration, use \`startTime: ${ctx.startTime.toFixed(2)}\` and \`endTime: ${ctx.endTime.toFixed(2)}\` (which is ${activeFrameCount} frames).
  - If the user specifies an explicit frame count (e.g. *"for 45 frames"*, *"for 90 frames"*), convert frames at 30fps (\`duration = frames / 30\`) so \`endTime = startTime + frames / 30\`.

### 2. PLACED BOXES & DOTS ON THE CANVAS RIGHT NOW
${colorLines}

### 3. EXISTING EDITS ON THE TIMELINE
${existingEditsLines}
${
  ctx.customContextPrompt && ctx.customContextPrompt.trim()
    ? `\n### 4. USER'S CUSTOM PROJECT INSTRUCTIONS\n${ctx.customContextPrompt.trim()}\n`
    : ''
}
### 5. OPEN-ENDED AI GENERATION (\`"effectType": "custom_ai"\`) — UNLIMITED CREATIVITY
**IMPORTANT RULE**: Never force or fallback to \`"neon_glow"\` or \`"color_grade"\` when the user asks for something creative, asks to add/place/draw/spawn an object, character, fruit, prop, effect, or asks for any custom visual!
Whenever the user asks to add, draw, place, spawn, or animate ANY visual object, character, prop, symbol, effect, or custom shader at a position (e.g. *"add a cool orange on this position"*, *"put a pixel sword"*, *"add a glowing dragon aura"*, *"draw a cute cat"*, *"spawn floating fireballs"*, *"add anime speed lines"*), use \`"effectType": "custom_ai"\` and combine any of these open-ended capabilities inside \`"params"\`:

1. **\`customSvg\` (string — Full Custom SVG Artwork Rendered at the Target Box/Dot)**:
   - Write a complete, self-contained \`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">...</svg>\` illustration!
   - Make your SVG artwork vivid, expressive, and detailed: use \`<defs>\`, \`<radialGradient>\`, \`<linearGradient>\`, drop shadows, layered shapes, highlights, outlines (\`stroke="#1d1a16"\`), and rich character/object details (for example, for *"a cool orange"*, draw a 3D radial-gradient orange citrus fruit with a green leaf, stem, dimples, cool dark sunglasses with white lens glints, and a confident smirk!).
   - Keep coordinates within \`viewBox="0 0 200 200"\` centered around \`(100, 100)\`.

2. **\`customAnimation\` (object — Procedural Motion & Physics on the Object/Effect)**:
   \`{ "scale"?: number (0.4 to 3.0, default 1.0), "opacity"?: number (0.1 to 1.0), "bobAmplitude"?: number (vertical hover px, e.g. 6), "bobSpeed"?: number (e.g. 4), "pulseAmount"?: number (scale pulse e.g. 0.08), "pulseSpeed"?: number (e.g. 5), "spinSpeed"?: number (deg/sec, e.g. 0 or 90), "shakeAmount"?: number (px, e.g. 0), "enter"?: "pop" | "fade" | "slide_down" | "slide_up" | "spin" | "none", "exit"?: "pop" | "fade" | "none", "offsetX"?: number (-0.5 to 0.5), "offsetY"?: number (-0.5 to 0.5), "moveToX"?: number (0.0 to 1.0), "moveToY"?: number (0.0 to 1.0) }\`

3. **\`customParticles\` (object — Dynamic Particle Emitter at the Target Box/Dot)**:
   \`{ "count": number (10 to 80), "shape": "spark" | "star" | "flame" | "circle" | "heart" | "bubble" | "snow" | "leaf" | "confetti", "colors": string[] (hex array, e.g. ["#ff9900", "#ffe066", "#ffffff"]), "speed"?: number (0.5 to 2.5), "size"?: number (4 to 18), "spread"?: number (0.5 to 2.5), "direction"?: "up" | "down" | "radial" | "drift", "glow"?: boolean }\`

4. **\`customCssFilter\` & \`customOverlayGradient\` (Custom Region or Full-Screen Shaders)**:
   - \`"customCssFilter"\`: Any valid CSS filter string (e.g. \`"contrast(140%) saturate(180%) hue-rotate(25deg)"\`) applied inside (\`"invertMask": false\`) or outside (\`"invertMask": true\`) the Box/Dot.
   - \`"customBlendMode"\`: \`"source-over" | "screen" | "multiply" | "overlay" | "color-dodge" | "hard-light" | "difference"\`
   - \`"customOverlayGradient"\`: \`{ "colors": ["#ff6600", "#ffcc00"], "type": "radial" | "linear", "angleDeg"?: number, "opacity"?: number (0.1 to 0.85) }\`

5. **\`customDrawCommands\` (array — Optional Procedural Canvas 2D Shapes around Target Center)**:
   Array of \`{ "type": "circle" | "ellipse" | "rect" | "roundRect" | "star" | "burst" | "polygon" | "line" | "ring" | "text", "x"?: number (-1..1), "y"?: number (-1..1), "radius"?: number (0.1..1.5), "width"?: number, "height"?: number, "spikes"?: number, "fill"?: string, "gradientColors"?: string[], "stroke"?: string, "lineWidth"?: number, "glowColor"?: string, "glowBlur"?: number, "rotationDeg"?: number, "text"?: string }\`

### 6. BUILT-IN SPECIALIZED COMPOSITOR TOOLS (Can also be used or combined with \`custom_ai\`)
- \`"zoom"\`: Camera zoom/pan into target Box/Dot center. \`params\`: \`{ "zoomScale": number (1.15 to 3.5), "zoomEasing": "smooth" | "instant" | "spring" }\`
- \`"blur"\`: Gaussian blur inside (\`invertMask: false\`) or bokeh blur outside (\`invertMask: true\`). \`params\`: \`{ "blurRadius": number (6 to 36), "invertMask": boolean }\`
- \`"pixelate"\`: Mosaic blocks inside or outside. \`params\`: \`{ "pixelBlockSize": number (8 to 28), "invertMask": boolean }\`
- \`"spotlight"\`: Darkens surroundings outside the Box/Dot. \`params\`: \`{ "dimOpacity": number (0.4 to 0.9) }\`
- \`"color_grade"\`: Color grading / B&W / tinting. \`params\`: \`{ "saturation"?: number, "brightness"?: number, "contrast"?: number, "sepia"?: number, "invert"?: number, "hueRotate"?: number, "tintColor"?: string, "tintOpacity"?: number, "invertMask"?: boolean }\`
- \`"neon_glow"\`: Only when the user specifically requests a neon/glowing outline around the Box/Dot. \`params\`: \`{ "glowColor": string, "glowIntensity": number, "pulse": boolean }\`
- \`"halftone_ink"\`: Manga halftone ink shader. \`params\`: \`{ "dotSpacing": number, "inkColor": string, "paperColor": string, "invertMask"?: boolean }\`
- \`"chromatic_aberration"\`: RGB split glitch. \`params\`: \`{ "aberrationOffset": number, "invertMask"?: boolean }\`
- \`"text_overlay"\`: Text plaque/caption. \`params\`: \`{ "text": string, "textStyle": "impact" | "callout" | "neon" | "subtitle", "textColor": string, "fontSize": number }\`
- \`"callout_shape"\`: HUD ring/brackets/arrow. \`params\`: \`{ "shapeType": "ring" | "brackets" | "arrow" | "box", "shapeColor": string }\`
- \`"speed"\`: Playback rate or freeze-frame. \`params\`: \`{ "playbackRate": number, "freezeFrame"?: boolean }\`
- \`"camera_fx"\`: Camera shake, vignette, cinema_bars, vhs_glitch, flash. \`params\`: \`{ "cameraEffect": string, "intensity": number }\`

### 7. OPTIONAL TIMELINE CUT / SPLIT ACTIONS
If the user explicitly asks to cut, trim, or delete a time segment:
\`{ "action": "cut", "startTime": number, "endTime": number, "summary": "Cut segment" }\` or \`{ "action": "split", "splitTime": number, "summary": "Split playhead" }\`.

### OUTPUT FORMAT (STRICT JSON ARRAY ONLY)
Return ONLY a valid JSON array (no markdown prose outside the JSON). Each edit item must follow:
[
  {
    "summary": "Short human-readable description of what you created (e.g. 'Cool Orange (SVG + Bounce) → Crimson')",
    "effectType": "custom_ai",
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

    const rawParams: Record<string, unknown> =
      item.params && typeof item.params === 'object'
        ? { ...(item.params as Record<string, unknown>) }
        : {};

    // Normalize top-level open-ended AI fields if the model placed them directly on the item
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
