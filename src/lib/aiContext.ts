import { formatShortEditSummary, summarizeColorGroups } from '@/lib/editCompiler';
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
  reasoningEffort?: 'low' | 'medium' | 'high';
  projectSounds?: Array<{
    id: string;
    name: string;
    durationSec?: number;
  }>;
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

  const soundLines =
    ctx.projectSounds && ctx.projectSounds.length > 0
      ? `\n3. **Available Project Sounds (Current Project -> Sound)**:\n` +
        ctx.projectSounds
          .map(
            (s) =>
              `   - Name: "${s.name}" | ID: "${s.id}" | Duration: ${(s.durationSec ?? 3.0).toFixed(2)}s`
          )
          .join('\n') +
        '\n'
      : '';

  return `You are an AI inside a video editor. You are given a spatial position on the video canvas and a timeframe, and the user asks you to do something at that position during that timeframe.

### CONTEXT
1. **Selected Timeframe**:
   - Start: \`${ctx.startTime.toFixed(2)}s\`
   - End: \`${ctx.endTime.toFixed(2)}s\`
   - Duration: \`${activeDurationSec.toFixed(2)}s\` (**${activeFrameCount} frames** at 30 fps; 1 frame = 1/30s)
   - Current Playhead: \`${(ctx.currentTime ?? ctx.startTime).toFixed(2)}s\`, Total Video Duration: \`${(ctx.duration ?? 12).toFixed(2)}s\`
   - Active Media Type: \`${ctx.mediaCategory ?? 'video'}\`
   - Focused Target: **${focusedColorName}** (\`"${focusedColorId || (colorSummary[0]?.color ?? 'all')}"\`)

2. **Marked Position(s) on the Video Canvas** (normalized \`0.0\` to \`1.0\`, where \`(0,0)\` is top-left and \`(1,1)\` is bottom-right):
${positionLines}
${soundLines}${
    ctx.customContextPrompt && ctx.customContextPrompt.trim()
      ? `\n4. **Additional Context**:\n${ctx.customContextPrompt.trim()}\n`
      : ''
  }
### HOW TO DO WHAT THE USER ASKS
Do whatever the user asks at the target position and timeframe by returning a JSON array with an object containing:
- \`"summary"\`: Ultra-short 1–2 word effect name (e.g. \`"Bounce Effect"\`, \`"Fire Effect"\`, \`"Text Effect"\`, \`"Zoom Effect"\`, \`"Sound 4"\`). Keep it <= 15 characters; never write a full sentence.
- \`"targetColor"\`: The target position's \`targetColor\` ID (e.g. \`"${focusedColorId || (colorSummary[0]?.color ?? 'all')}"\`).
- \`"startTime"\`: Start time in seconds (default \`${ctx.startTime.toFixed(2)}\`).
- \`"endTime"\`: End time in seconds (default \`${ctx.endTime.toFixed(2)}\`, or \`startTime + frames / 30\` if the user specifies a frame count, or \`startTime + soundDuration\` if the user asks to lengthen the dot/color interval to fit a sound).
- \`"audioAssetName"\` (string, optional): If the user asks to use or play a sound from Available Project Sounds (e.g. "use the sound Recorded Sound 1 here"), set this to the exact sound name (e.g. \`"Recorded Sound 1.webm"\`). IMPORTANT: When the user asks ONLY to play a sound on the video without any visual effect, keep the video visible and do NOT provide \`renderCode\` or \`svg\`; when the user asks for BOTH a visual/screen effect (e.g. bounce, zoom, fire, text) AND a sound, provide BOTH \`renderCode\` AND \`audioAssetName\`.
- \`"duration"\` (number, optional): ONLY use when \`Active Media Type\` is \`image\` and the user asks to change the total timeline duration of the static image. Never set \`duration\` when editing a video (to change the length of a color/dot interval on a video, set \`"endTime"\` instead!).
- \`"playbackRate"\` (number, optional): Set video playback speed during \`[startTime, endTime]\` (e.g. \`0.25\` to \`4.0\`; works simultaneously with \`renderCode\`).
- \`"freezeFrame"\` (boolean, optional): Freeze video playback during \`[startTime, endTime]\`.
- \`"customCssFilter"\` (string, optional): CSS filter applied to the region/frame (e.g. \`"contrast(160%) saturate(180%) hue-rotate(45deg)"\`).
- \`"renderCode"\` (string, optional): JavaScript code body executed every frame on the HTML5 2D Canvas during \`[startTime, endTime]\`.
  Your \`renderCode\` runs inside \`function(ctx, env) { ... }\` where both \`ctx\` and all properties & low-level engine primitives of \`env\` are directly in scope so you can invent ANY visual, temporal, physics, or audio-reactive effect from first principles:
  - \`ctx\`: \`CanvasRenderingContext2D\` of the output video canvas
  - \`sourceCanvas\`: \`HTMLCanvasElement\` containing the current live unedited video frame
  - \`state\`: Persistent object (\`Record<string, any>\`) preserved across frames for this edit (store particles, physics velocities, timers, or custom buffers here!)
  - **General-Purpose Engine Primitives (directly callable in \`renderCode\`)**:
    - \`clearFrame(color = '#000000')\`: Clears the pre-drawn live video frame from \`ctx\`.
    - \`createBuffer(id = 'buf', bw = width, bh = height)\`: Returns a persistent offscreen \`{ canvas, ctx }\` preserved across frames for multi-pass effects, motion blur, feedback loops, pixel manipulation, or custom caching.
    - \`holdFrame(stepSeconds = 0.28)\`: Captures and holds a frozen video frame for \`stepSeconds\` real seconds at a time and returns that \`HTMLCanvasElement\`.
    - \`getPastFrame(secondsAgo = 0.35)\`: Returns a real historical \`HTMLCanvasElement\` snapshot from \`secondsAgo\` real seconds in the past (up to \`1.8\` seconds ago) for time-echo, rewind, rubberbanding, datamoshing, or ghost trails.
    - \`setPlaybackRate(rate)\`: Dynamically controls the \`<video>\` playback speed (\`0.0625\` to \`4.0\`) on the fly every frame.
    - \`playTone(freqHz = 440, durationSec = 0.08, type = 'sine', volume = 0.15)\`: Plays a procedural Web Audio tone (\`type\`: \`'sine' | 'square' | 'sawtooth' | 'triangle'\`, rate-limited per edit) if the effect calls for synthesized sound.
    - \`hash(n)\`: Deterministic pseudo-random float in \`[0, 1)\` for any seed number \`n\`.
    - \`noise(nx, ny = 0)\`: Smooth 2D value noise in \`[0, 1]\` for organic motion, camera shake, fire, water, or procedural textures.
  - **CRITICAL ENGINE ARCHITECTURE RULES (Why naive Canvas code fails unless you follow these 4 rules)**:
    1. **Pre-Drawn Base Frame Rule**: Before your \`renderCode\` runs, the compositor has ALREADY drawn the live 60fps \`sourceCanvas\` onto \`ctx\`. Therefore:
       - If you are adding an **overlay** (particles, fire, text, HUD, lightning, stickers) on top of the video, just draw directly onto \`ctx\`.
       - If you are **transforming, moving, bouncing, rotating, warping, freezing, lagging, or replacing** the video frame itself, you MUST call \`clearFrame('#000000')\` (or overwrite the full canvas) BEFORE drawing your transformed/frozen frame, AND you must NOT draw the live \`sourceCanvas\` at 100% opacity on top of a frozen/past frame (which would completely cover up your effect!).
    2. **Real-Seconds vs. Render-Tick Rule**: \`renderCode\` executes at the monitor refresh rate (60–144Hz), where 1 frame tick is only \`~0.008s–0.016s\`, and timeline intervals can be \`5s–30s\` long.
       - Never hold frames by counting \`frame % 4\` (4 ticks at 120Hz is 33ms, invisible to the human eye!). Always use real seconds with \`elapsed\`, \`Math.floor(elapsed / 0.28)\`, \`holdFrame(0.28)\`, or \`getPastFrame(0.35)\`.
       - Never drive oscillation frequency with \`progress * 3\` (which stretches 3 slow cycles across a 20-second clip). Always drive frequencies with \`elapsed\` in real seconds (e.g. \`elapsed * 9.0\`).
    3. **Visual Scale Rule**: The canvas is high-resolution (\`width\` is typically \`1280\`–\`1920\`, \`scale = width / 960\`). Tiny 2–5px offsets are invisible; use bold, unmistakable amplitudes scaled by \`scale\` (e.g. \`35 * scale\` to \`80 * scale\` px for motion, displacement, or particles).
    4. **Region vs. Fullscreen Rule**: Check \`w\` and \`h\` vs \`width\` and \`height\`. If the target is a specific object/box (\`w < width * 0.9 || h < height * 0.9\`), center or clip your effect around \`(cx, cy)\` / \`(x, y, w, h)\`; if fullscreen, apply across \`(0, 0, width, height)\`.
  - \`cx\`, \`cy\`: Target position center in pixels on the canvas (automatically updated every frame by the engine's real-time optical pixel tracker to follow the marked object as it moves!)
  - \`x\`, \`y\`, \`w\`, \`h\`: Target region top-left and width/height in pixels (also automatically tracked per-frame when following a moving object)
  - \`r\`: Target radius in pixels at that position
  - \`width\`, \`height\`: Full canvas width and height in pixels
  - \`scale\`: Resolution scale factor (\`width / 960\`)
  - \`t\`: Current video timestamp in seconds
  - \`elapsed\`: Seconds elapsed since \`startTime\` (\`t - startTime\`)
  - \`duration\`: Total seconds in \`[startTime, endTime]\`
  - \`progress\`: \`0.0\` to \`1.0\` progress through the timeframe
  - \`frame\`: Current frame number within the timeframe (\`0\` to \`totalFrames\`)
  - \`totalFrames\`: Total frames in the timeframe (\`Math.round(duration * 30)\`)
- \`"svg"\` (string, optional): A complete \`<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">...</svg>\` illustration to render centered at \`(cx, cy)\`. You can provide \`renderCode\`, \`svg\`, or both.${
    ctx.reasoningEffort === 'high'
      ? `\n\n### HIGH EFFORT MODE (MAXIMUM VISUAL QUALITY & PHYSICS DETAIL)\nThe user selected HIGH EFFORT. Put maximum craft into your \`renderCode\` / \`svg\`:\n- Build rich multi-layered visuals (core layer, secondary harmonic motion/squash-and-stretch, atmospheric glow/lighting gradients, and fine procedural particle/detail passes).\n- Use smooth easing, multi-stop radial/linear gradients, and lively \`elapsed\`-driven physics so the effect looks studio-grade and unmistakable on screen.`
      : ctx.reasoningEffort === 'low'
      ? `\n\n### LOW EFFORT MODE (FAST & CONCISE)\nThe user selected LOW EFFORT. Keep \`renderCode\` direct, clean, and minimal for instant generation.`
      : ''
  }

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
  newDuration?: number;
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
  let newDuration: number | undefined;

  rawItems.forEach((item, idx) => {
    if (
      typeof item.duration === 'number' &&
      item.duration > 0 &&
      ctx.mediaCategory === 'image'
    ) {
      newDuration = item.duration;
    }
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
    if (typeof item.playbackRate === 'number' && !rawParams.playbackRate) {
      rawParams.playbackRate = item.playbackRate;
    }
    if (typeof item.freezeFrame === 'boolean' && rawParams.freezeFrame === undefined) {
      rawParams.freezeFrame = item.freezeFrame;
    }

    // Handle attached sound asset (audioAssetName / audioAssetId)
    const rawSoundName =
      (typeof item.audioAssetName === 'string' && item.audioAssetName) ||
      (typeof item.sound === 'string' && item.sound) ||
      (typeof item.audio === 'string' && item.audio) ||
      (typeof rawParams.audioAssetName === 'string' && rawParams.audioAssetName) ||
      '';
    const rawSoundId =
      (typeof item.audioAssetId === 'string' && item.audioAssetId) ||
      (typeof rawParams.audioAssetId === 'string' && rawParams.audioAssetId) ||
      '';

    let matchedProjectSound:
      | { id: string; name: string; durationSec?: number }
      | undefined;

    if (ctx.projectSounds && ctx.projectSounds.length > 0) {
      if (rawSoundId) {
        matchedProjectSound = ctx.projectSounds.find((s) => s.id === rawSoundId);
      }
      if (!matchedProjectSound && rawSoundName) {
        const normTarget = rawSoundName
          .toLowerCase()
          .replace(/\.[a-z0-9]+$/i, '')
          .trim();
        matchedProjectSound = ctx.projectSounds.find((s) => {
          const normS = s.name.toLowerCase().replace(/\.[a-z0-9]+$/i, '').trim();
          return (
            s.name.toLowerCase() === rawSoundName.toLowerCase().trim() ||
            normS === normTarget ||
            normS.includes(normTarget) ||
            normTarget.includes(normS)
          );
        });
      }
      // Also match directly from user prompt if user asked for a project sound
      if (!matchedProjectSound && /\b(sound|audio|play|recorded)\b/i.test(ctx.prompt)) {
        const lowerP = ctx.prompt.toLowerCase();
        matchedProjectSound = ctx.projectSounds.find((s) => {
          const baseName = s.name.toLowerCase().replace(/\.[a-z0-9]+$/i, '').trim();
          return baseName.length > 0 && lowerP.includes(baseName);
        });
        if (!matchedProjectSound && ctx.projectSounds.length === 1) {
          matchedProjectSound = ctx.projectSounds[0];
        }
      }
    }

    if (matchedProjectSound) {
      rawParams.audioAssetId = matchedProjectSound.id;
      rawParams.audioAssetName = matchedProjectSound.name;
      // If user asked ONLY to play/use a sound without asking for a visual effect, keep video clean (no visual overlay)
      const askedForVisualToo =
        /\b(bounce|bouncing|jump|hop|lag|lagging|stutter|choppy|rubberband|wobble|wave|pulse|vibrate|effect|animate|animation|move|moving|slide|flip|scale|stretch|squash|draw|zoom|blur|glow|text|spin|rotate|color|pixelate|spotlight|shake|flash|fire|flame|water|rain|snow|spark|particle|screen|frame|box|circle|arrow)\b/i.test(
          ctx.prompt
        ) ||
        (typeof rawParams.renderCode === 'string' &&
          /\b(drawImage\s*\(\s*sourceCanvas|holdFrame|getPastFrame|createBuffer|clearFrame)\b/.test(
            rawParams.renderCode
          ));
      if (!askedForVisualToo) {
        delete rawParams.renderCode;
        delete rawParams.customSvg;
        delete rawParams.svg;
      }
    } else if (rawSoundName) {
      rawParams.audioAssetName = rawSoundName;
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
        : typeof item.duration === 'number' &&
          item.duration > 0 &&
          ctx.mediaCategory !== 'image'
        ? Number((itemStart + item.duration).toFixed(2))
        : ctx.endTime;

    // If a project sound is attached and the sound is longer than the current interval (or user asked to increase length if needed), extend itemEnd to fit the sound!
    if (
      matchedProjectSound &&
      typeof matchedProjectSound.durationSec === 'number' &&
      matchedProjectSound.durationSec > 0
    ) {
      const soundEnd = Number(
        (itemStart + matchedProjectSound.durationSec).toFixed(2)
      );
      if (
        soundEnd > itemEnd ||
        /\b(increase|extend|lengthen|length|longer|fit|full\s+sound|if\s+needed)\b/i.test(
          ctx.prompt
        )
      ) {
        itemEnd = Math.max(itemEnd, soundEnd);
      }
    }

    // If the user explicitly specified a number of frames (e.g. "for 45 frames"), honor that exact frame count
    const explicitFramesMatch = ctx.prompt.match(/\bfor\s+(\d+)\s*frames?\b/i);
    if (explicitFramesMatch) {
      const frameCount = Math.max(1, parseInt(explicitFramesMatch[1], 10));
      itemEnd = Number((itemStart + frameCount / DEFAULT_FPS).toFixed(2));
    }

    edits.push({
      id: `ai-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      prompt: ctx.prompt,
      summary: formatShortEditSummary(
        typeof item.summary === 'string' ? item.summary : undefined,
        ctx.prompt,
        effectType
      ),
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

  return { edits, cutsToAdd, splitsToAdd, newDuration };
}
