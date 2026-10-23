// Dynamic distinct color identifier (supports 512+ algorithmically generated distinct colors)
export type MarkColor = string;

export interface MarkColorConfig {
  id: MarkColor;
  name: string;
  hex: string;
  fillRgba: string;
  borderHex: string;
  textColorHex: string;
  badgeBg: string;
  badgeText: string;
  lab: [number, number, number]; // CIE L*a*b* perceptual coordinates for max-min Delta-E distance
}

const HUE_NAMES = [
  'Crimson',
  'Vermilion',
  'Coral',
  'Tangerine',
  'Amber',
  'Marigold',
  'Gold',
  'Citrine',
  'Chartreuse',
  'Lime',
  'Olive',
  'Peridot',
  'Emerald',
  'Jade',
  'Mint',
  'Viridian',
  'Teal',
  'Turquoise',
  'Cyan',
  'Aquamarine',
  'Cerulean',
  'Azure',
  'Cobalt',
  'Sapphire',
  'Indigo',
  'Ultramarine',
  'Violet',
  'Amethyst',
  'Orchid',
  'Magenta',
  'Fuchsia',
  'Rose',
];

const TONE_PREFIXES = [
  '',
  'Vivid ',
  'Bright ',
  'Deep ',
  'Electric ',
  'Rich ',
  'Radiant ',
  'Bold ',
  'Neon ',
  'Royal ',
  'Pure ',
  'Warm ',
  'Cool ',
  'Sharp ',
  'Wild ',
  'Prime ',
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round(Math.min(255, Math.max(0, (r1 + m) * 255))),
    Math.round(Math.min(255, Math.max(0, (g1 + m) * 255))),
    Math.round(Math.min(255, Math.max(0, (b1 + m) * 255))),
  ];
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const srgb = [r / 255, g / 255, b / 255].map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  const [R, G, B] = srgb;
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE(
  lab1: [number, number, number],
  lab2: [number, number, number]
): number {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

function vanDerCorput(n: number, base: number): number {
  let q = 0;
  let bk = 1 / base;
  let num = n;
  while (num > 0) {
    q += (num % base) * bk;
    num = Math.floor(num / base);
    bk /= base;
  }
  return q;
}

function buildColorConfig(
  id: string,
  name: string,
  r: number,
  g: number,
  b: number
): MarkColorConfig {
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  const fillRgba = `rgba(${r}, ${g}, ${b}, 0.24)`;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const textColorHex = luminance > 0.66 ? '#1d1a16' : '#ffffff';
  return {
    id,
    name,
    hex,
    fillRgba,
    borderHex: '#1d1a16',
    textColorHex,
    badgeBg: 'border-[#1d1a16]',
    badgeText: luminance > 0.66 ? 'text-[#1d1a16]' : 'text-[#ffffff]',
    lab: rgbToLab(r, g, b),
  };
}

export const DISTINCT_COLOR_POOL_SIZE = 512;

const BASE_SEED_COLORS: Array<{ id: string; name: string; r: number; g: number; b: number }> = [
  { id: 'red', name: 'Crimson', r: 214, g: 45, b: 36 },
  { id: 'blue', name: 'Cobalt', r: 37, g: 99, b: 235 },
  { id: 'green', name: 'Emerald', r: 22, g: 163, b: 74 },
  { id: 'yellow', name: 'Amber', r: 217, g: 130, b: 24 },
  { id: 'purple', name: 'Violet', r: 139, g: 61, b: 216 },
  { id: 'cyan', name: 'Teal', r: 13, g: 148, b: 136 },
  { id: 'orange', name: 'Tangerine', r: 234, g: 88, b: 12 },
  { id: 'pink', name: 'Magenta', r: 219, g: 39, b: 119 },
];

const GENERATED_COLORS: Record<string, MarkColorConfig> = {};
export const COLOR_PROGRESSION: MarkColor[] = [];

// 1. Register the 8 core seed colors
for (const seed of BASE_SEED_COLORS) {
  GENERATED_COLORS[seed.id] = buildColorConfig(
    seed.id,
    seed.name,
    seed.r,
    seed.g,
    seed.b
  );
  COLOR_PROGRESSION.push(seed.id);
}

// 2. Algorithmically generate up to 512 perceptually distinct colors using Golden-Angle + Halton sequences
const GOLDEN_ANGLE = 137.50776405003785;
for (let i = BASE_SEED_COLORS.length; i < DISTINCT_COLOR_POOL_SIZE; i++) {
  const hue = (i * GOLDEN_ANGLE) % 360;
  const sat = 0.68 + vanDerCorput(i, 3) * 0.27; // 68% to 95% vivid saturation
  const light = 0.38 + vanDerCorput(i, 2) * 0.26; // 38% to 64% high-contrast lightness
  const [r, g, b] = hslToRgb(hue, sat, light);

  const hueIdx = Math.floor((hue / 360) * HUE_NAMES.length) % HUE_NAMES.length;
  const toneIdx = Math.floor(i / HUE_NAMES.length) % TONE_PREFIXES.length;
  const id = `c_${i + 1}`;
  const name = `${TONE_PREFIXES[toneIdx]}${HUE_NAMES[hueIdx]} #${i + 1}`;

  GENERATED_COLORS[id] = buildColorConfig(id, name, r, g, b);
  COLOR_PROGRESSION.push(id);
}

export const MARK_COLORS: Record<MarkColor, MarkColorConfig> = new Proxy(
  GENERATED_COLORS,
  {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      // Fallback deterministic color if an unknown color key is ever queried
      return target.red;
    },
  }
);

export type DrawingTool = 'rect' | 'dot' | 'brush' | 'circle' | 'arrow';

export type BuiltInSceneId = 'scenic_valley' | 'night_express' | 'street_market';

export interface NormalizedPoint {
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
}

export interface BoundingBox {
  x: number;      // 0.0 to 1.0 (left)
  y: number;      // 0.0 to 1.0 (top)
  width: number;  // 0.0 to 1.0
  height: number; // 0.0 to 1.0
  cx: number;     // center x (0.0 to 1.0)
  cy: number;     // center y (0.0 to 1.0)
}

export interface ScreenAnnotation {
  id: string;
  color: MarkColor;
  tool: DrawingTool;
  points: NormalizedPoint[];
  strokeWidth: number;
  bbox: BoundingBox;
  createdAtTime: number;
  startTime?: number; // Timeframe start that this highlight belongs to
  endTime?: number;   // Timeframe end that this highlight belongs to
}

export type EffectType =
  | 'custom_ai'
  | 'zoom'
  | 'blur'
  | 'pixelate'
  | 'spotlight'
  | 'color_grade'
  | 'neon_glow'
  | 'halftone_ink'
  | 'chromatic_aberration'
  | 'generative_replace'
  | 'text_overlay'
  | 'callout_shape'
  | 'speed'
  | 'camera_fx';

export interface AiCanvasDrawCommand {
  type:
    | 'circle'
    | 'ellipse'
    | 'rect'
    | 'roundRect'
    | 'star'
    | 'burst'
    | 'polygon'
    | 'line'
    | 'ring'
    | 'text';
  x?: number; // Normalized offset from target center (-1.0 to 1.0, where 1.0 = target radius)
  y?: number; // Normalized offset from target center (-1.0 to 1.0)
  radius?: number; // Relative to target radius (e.g. 0.5)
  rx?: number;
  ry?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  points?: Array<{ x: number; y: number }>;
  spikes?: number;
  innerRadius?: number;
  fill?: string;
  gradientColors?: string[];
  stroke?: string;
  lineWidth?: number;
  glowColor?: string;
  glowBlur?: number;
  opacity?: number;
  rotationDeg?: number;
  text?: string;
  fontSize?: number;
}

export interface AiCustomAnimation {
  scale?: number; // Size multiplier (default 1.0)
  opacity?: number; // 0.0 to 1.0
  bobAmplitude?: number; // Vertical hover amplitude in px at 960p (e.g. 6)
  bobSpeed?: number; // Hover speed (e.g. 4.0)
  pulseAmount?: number; // Scale pulse amplitude (e.g. 0.08 = ±8%)
  pulseSpeed?: number; // Pulse frequency (e.g. 5.0)
  spinSpeed?: number; // Continuous rotation in degrees per second (e.g. 90)
  shakeAmount?: number; // Vibration amplitude in px (e.g. 4)
  enter?: 'pop' | 'fade' | 'slide_down' | 'slide_up' | 'spin' | 'none';
  exit?: 'pop' | 'fade' | 'none';
  offsetX?: number; // Normalized screen offset X (-0.5 to 0.5)
  offsetY?: number; // Normalized screen offset Y (-0.5 to 0.5)
  moveToX?: number; // Optional destination normalized X (0.0 to 1.0) over the timeframe
  moveToY?: number; // Optional destination normalized Y (0.0 to 1.0) over the timeframe
}

export interface AiCustomParticles {
  count?: number; // Number of particles (e.g. 12 to 80)
  shape?:
    | 'circle'
    | 'star'
    | 'spark'
    | 'flame'
    | 'heart'
    | 'bubble'
    | 'snow'
    | 'leaf'
    | 'confetti';
  colors?: string[];
  speed?: number; // Speed multiplier (0.3 to 3.0)
  size?: number; // Base particle size in px (4 to 24)
  spread?: number; // Spread multiplier relative to target bbox (0.5 to 3.0)
  direction?: 'up' | 'down' | 'radial' | 'drift';
  glow?: boolean;
}

export interface AiOverlayGradient {
  colors: string[];
  type?: 'radial' | 'linear';
  angleDeg?: number;
  opacity?: number;
}

export interface EffectParams {
  // Zoom / Pan
  zoomScale?: number;
  zoomEasing?: 'smooth' | 'instant' | 'spring';

  // Blur / Pixelate
  blurRadius?: number;
  pixelBlockSize?: number;
  invertMask?: boolean;

  // Spotlight
  dimOpacity?: number;

  // Color Grade
  saturation?: number;
  brightness?: number;
  contrast?: number;
  hueRotate?: number;
  sepia?: number;
  invert?: number;
  tintColor?: string;
  tintOpacity?: number;

  // Neon / Glow
  glowColor?: string;
  glowIntensity?: number;
  pulse?: boolean;

  // Halftone / Manga Ink
  dotSpacing?: number;
  inkColor?: string;
  paperColor?: string;

  // Chromatic Aberration / RGB Split
  aberrationOffset?: number;

  // Open-Ended AI Position + Timeframe Execution Engine
  renderCode?: string;
  svg?: string;
  frameCount?: number;
  generativePrompt?: string;
  generativeStyle?: 'cyber' | 'fire' | 'watercolor' | 'hologram' | 'gold_aura';
  stickerObject?: string;
  customSvg?: string;
  customDrawCommands?: AiCanvasDrawCommand[];
  customParticles?: AiCustomParticles;
  customCssFilter?: string;
  customBlendMode?: GlobalCompositeOperation;
  customOverlayGradient?: AiOverlayGradient;
  customAnimation?: AiCustomAnimation;
  cloudJobUrl?: string;

  // Text / Callout Overlay
  text?: string;
  textStyle?: 'impact' | 'subtitle' | 'callout' | 'neon';
  textColor?: string;
  fontSize?: number;

  // Callout Shape
  shapeType?: 'ring' | 'brackets' | 'arrow' | 'box';
  shapeColor?: string;
  label?: string;

  // Speed
  playbackRate?: number;
  freezeFrame?: boolean;

  // Camera FX
  cameraEffect?: 'shake' | 'vignette' | 'cinema_bars' | 'vhs_glitch' | 'flash';
  intensity?: number;

  // Attached Sound Asset (plays during [startTime, endTime] alongside video)
  audioAssetId?: string;
  audioAssetName?: string;
  audioVolume?: number;

  // Attached Image / Video Asset from the App Media Library
  imageAssetId?: string;
  imageAssetName?: string;
}

export interface TimelineEditItem {
  id: string;
  prompt: string;
  summary: string;
  startTime: number;
  endTime: number;
  effectType: EffectType;
  targetColor?: MarkColor | 'all';
  annotations: ScreenAnnotation[];
  params: EffectParams;
  enabled: boolean;
  aiProvider?: string;
  tokensUsed?: number;
}

export interface ColorGroupSummary {
  color: MarkColor;
  count: number;
  combinedBbox: BoundingBox;
  tools: DrawingTool[];
  isMotionTracked: boolean;
  startTime: number;
  endTime: number;
}

export type ExportResolutionPreset = '720p' | '1080p' | '1440p' | '4k' | 'native';

export interface ExportConfig {
  resolution: ExportResolutionPreset;
  fps: 24 | 30 | 60;
  bitrateMbps: 12 | 24 | 35 | 50;
  range: 'full' | 'interval';
  includeAudio: boolean;
}

export interface VideoMetadataInfo {
  width: number;
  height: number;
  duration: number;
  aspectRatioLabel: string;
  hasAudio: boolean;
  isCustomVideo: boolean;
}

export interface ProjectFileSchema {
  version: string;
  exportedAt: string;
  sceneId: BuiltInSceneId;
  intervalStart: number;
  intervalEnd: number;
  annotations: ScreenAnnotation[];
  edits: TimelineEditItem[];
}

export const EXPORT_RESOLUTION_MAP: Record<
  Exclude<ExportResolutionPreset, 'native'>,
  { label: string; width: number; height: number; recommendedBitrate: 12 | 24 | 35 | 50 }
> = {
  '720p': { label: '720p HD (1280×720)', width: 1280, height: 720, recommendedBitrate: 12 },
  '1080p': { label: '1080p Full HD (1920×1080)', width: 1920, height: 1080, recommendedBitrate: 24 },
  '1440p': { label: '1440p 2K QHD (2560×1440)', width: 2560, height: 1440, recommendedBitrate: 35 },
  '4k': { label: '4K Ultra HD (3840×2160)', width: 3840, height: 2160, recommendedBitrate: 50 },
};

/**
 * Randomized Max-Min Perceptual Distance (Farthest-Point Sampling in CIE L*a*b* space)
 * Picks a random distinct color from the 512-color pool that maximizes perceptual Delta-E
 * distance from recently placed colors and currently active colors.
 */
export function getNextHighlightColor(
  existingAnnotations: ScreenAnnotation[],
  recentColors: MarkColor[] = []
): MarkColor {
  const usedSet = new Set(existingAnnotations.map((a) => a.color));
  for (const rc of recentColors) {
    usedSet.add(rc);
  }

  // Recent colors to avoid (last 10 placed annotations + explicit recent list)
  const recentLabs: Array<[number, number, number]> = [];
  const tailAnns = existingAnnotations.slice(-10);
  for (const ann of tailAnns) {
    const cfg = MARK_COLORS[ann.color];
    if (cfg) recentLabs.push(cfg.lab);
  }
  for (const rc of recentColors.slice(-6)) {
    const cfg = MARK_COLORS[rc];
    if (cfg) recentLabs.push(cfg.lab);
  }

  // Unused candidate pool across all 512 colors
  const unusedPool = COLOR_PROGRESSION.filter((c) => !usedSet.has(c));
  const pool = unusedPool.length > 0 ? unusedPool : COLOR_PROGRESSION;

  // If no prior colors exist yet, pick randomly from the first 32 vivid colors
  if (recentLabs.length === 0) {
    const idx = Math.floor(Math.random() * Math.min(32, pool.length));
    return pool[idx];
  }

  // Sample up to 64 random candidates from the pool and score each by its minimum perceptual Delta-E distance
  // to all recent/active colors (Farthest-Point Sampling)
  const sampleCount = Math.min(64, pool.length);
  const scored: Array<{ color: MarkColor; minDist: number }> = [];

  for (let i = 0; i < sampleCount; i++) {
    const candColor = pool[Math.floor(Math.random() * pool.length)];
    const candLab = MARK_COLORS[candColor].lab;

    let minDist = Number.POSITIVE_INFINITY;
    for (let j = 0; j < recentLabs.length; j++) {
      const d = deltaE(candLab, recentLabs[j]);
      // Weight the very last 3 colors even more strongly so consecutive placements always contrast sharply
      const weight = j >= recentLabs.length - 3 ? 0.65 : 1.0;
      const weightedDist = d * weight;
      if (weightedDist < minDist) {
        minDist = weightedDist;
      }
    }
    scored.push({ color: candColor, minDist });
  }

  scored.sort((a, b) => b.minDist - a.minDist);
  // Pick randomly among the top 5 most perceptually distant candidates
  const topK = Math.min(5, scored.length);
  return scored[Math.floor(Math.random() * topK)].color;
}

/**
 * Checks whether a highlight annotation belongs to or overlaps the given [startTime, endTime] timeframe.
 */
export function isAnnotationInTimeframe(
  ann: ScreenAnnotation,
  startTime: number,
  endTime: number
): boolean {
  if (ann.startTime === undefined || ann.endTime === undefined) {
    return true;
  }
  // Overlap check with small epsilon
  return ann.startTime <= endTime + 0.05 && ann.endTime >= startTime - 0.05;
}

export type AiProviderId =
  | 'auto'
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'xai'
  | 'mistral'
  | 'custom'
  | 'local';

export type ImageGenModeId =
  | 'auto'
  | 'openai'
  | 'gemini'
  | 'xai'
  | 'huggingface'
  | 'stability'
  | 'code_draw';

export type AiReasoningEffort = 'low' | 'medium' | 'high';

export interface AiSettingsConfig {
  provider: AiProviderId;
  model: string;
  apiKeys: Partial<Record<AiProviderId, string>>;
  customBaseUrl: string;
  customContextPrompt: string;
  imageApiKey?: string;
  imageGenMode?: ImageGenModeId;
  reasoningEffort?: AiReasoningEffort;
}

export interface AiProviderDefinition {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  models: Array<{ id: string; label: string }>;
  keyPlaceholder: string;
  supportsVision: boolean;
  baseUrl?: string;
}

export const AI_PROVIDER_CATALOG: AiProviderDefinition[] = [
  {
    id: 'auto',
    label: 'Auto-Detect (Any Key / DeepSeek / Gemini / OpenAI / Claude)',
    defaultModel: 'auto',
    models: [{ id: 'auto', label: 'Automatic Best Model for Key' }],
    keyPlaceholder: 'Paste any API key (DeepSeek sk-..., Gemini AIza..., OpenAI sk-..., Claude sk-ant-..., OpenRouter sk-or-...)',
    supportsVision: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (V3 / R1)',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3 (deepseek-chat — Fast & Accurate)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1 (deepseek-reasoner — Deep Reasoning)' },
    ],
    keyPlaceholder: 'sk-...',
    supportsVision: false,
    baseUrl: 'https://api.deepseek.com/chat/completions',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT-4o / o3-mini)',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast Vision + JSON)' },
      { id: 'gpt-4o', label: 'GPT-4o (Flagship Multimodal Vision)' },
      { id: 'o3-mini', label: 'o3-mini (Reasoning)' },
    ],
    keyPlaceholder: 'sk-proj-...',
    supportsVision: true,
    baseUrl: 'https://api.openai.com/v1/chat/completions',
  },
  {
    id: 'gemini',
    label: 'Google Gemini (2.5 Flash / Pro)',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Multimodal Vision)' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Advanced Multimodal)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
    keyPlaceholder: 'AIzaSy...',
    supportsVision: true,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude (3.7 / 3.5 Sonnet)',
    defaultModel: 'claude-3-7-sonnet-latest',
    models: [
      { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet (Vision)' },
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet (Vision)' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku (Fast)' },
    ],
    keyPlaceholder: 'sk-ant-...',
    supportsVision: true,
    baseUrl: 'https://api.anthropic.com/v1/messages',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (DeepSeek / Claude / GPT / Qwen / Llama)',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3 (via OpenRouter)' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1 (via OpenRouter)' },
      { id: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash (via OpenRouter)' },
      { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet (via OpenRouter)' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini (via OpenRouter)' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    supportsVision: true,
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
  },
  {
    id: 'groq',
    label: 'Groq (Ultra-Fast Llama 3.3 / DeepSeek R1)',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B' },
      { id: 'llama-3.2-90b-vision-preview', label: 'Llama 3.2 90B Vision' },
    ],
    keyPlaceholder: 'gsk_...',
    supportsVision: false,
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    id: 'xai',
    label: 'xAI (Grok 2 / Vision)',
    defaultModel: 'grok-2-latest',
    models: [
      { id: 'grok-2-latest', label: 'Grok 2 Latest' },
      { id: 'grok-2-vision-latest', label: 'Grok 2 Vision' },
    ],
    keyPlaceholder: 'xai-...',
    supportsVision: true,
    baseUrl: 'https://api.x.ai/v1/chat/completions',
  },
  {
    id: 'mistral',
    label: 'Mistral AI (Large / Pixtral)',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'pixtral-large-latest', label: 'Pixtral Large (Vision)' },
    ],
    keyPlaceholder: 'Mistral API key...',
    supportsVision: true,
    baseUrl: 'https://api.mistral.ai/v1/chat/completions',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-Compatible (Ollama / LM Studio / vLLM)',
    defaultModel: 'deepseek-r1:latest',
    models: [
      { id: 'deepseek-r1:latest', label: 'deepseek-r1:latest (Ollama)' },
      { id: 'llama3.2:latest', label: 'llama3.2:latest (Ollama)' },
      { id: 'qwen2.5-coder:latest', label: 'qwen2.5-coder:latest (Ollama)' },
    ],
    keyPlaceholder: 'Optional API key (leave blank for local Ollama)',
    supportsVision: false,
    baseUrl: 'http://localhost:11434/v1/chat/completions',
  },
  {
    id: 'local',
    label: 'Built-in Instant Semantic Engine (No API Key Needed)',
    defaultModel: 'semantic-v2',
    models: [{ id: 'semantic-v2', label: 'ChromaCut Local Semantic Compiler v2' }],
    keyPlaceholder: 'No API key required',
    supportsVision: false,
  },
];

/**
 * Resolves any color reference (ID like 'red' or 'c_14', display name like 'Crimson' or 'Cobalt' or 'Vivid Gold #15')
 * against the placed annotations first, and then against the full 512-color catalog.
 */
export function resolveColorId(
  rawColorRef: string | undefined | null,
  placedColors: MarkColor[] = [],
  fallbackColor: MarkColor | 'all' = 'all'
): MarkColor | 'all' {
  if (!rawColorRef) return fallbackColor;
  const cleaned = rawColorRef.trim().toLowerCase();
  if (!cleaned || cleaned === 'all' || cleaned === 'full' || cleaned === 'frame' || cleaned === 'global') {
    return 'all';
  }

  // 1. Direct ID match in placedColors or COLOR_PROGRESSION
  for (const pc of placedColors) {
    if (pc.toLowerCase() === cleaned) return pc;
  }
  if (COLOR_PROGRESSION.includes(cleaned)) {
    return cleaned;
  }

  // 2. Match against placedColors display names (e.g. "Crimson", "Cobalt", "Vivid Emerald #15")
  for (const pc of placedColors) {
    const cfg = MARK_COLORS[pc];
    if (!cfg) continue;
    const nameLower = cfg.name.toLowerCase();
    if (
      nameLower === cleaned ||
      cleaned.includes(nameLower) ||
      nameLower.includes(cleaned)
    ) {
      return pc;
    }
  }

  // 3. Match against any of the 512 colors by display name
  for (const cid of COLOR_PROGRESSION) {
    const cfg = MARK_COLORS[cid];
    if (cfg && cfg.name.toLowerCase() === cleaned) {
      return cid;
    }
  }

  return fallbackColor;
}

