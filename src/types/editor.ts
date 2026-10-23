// Simple colors first, followed by unusual/extended colors when simple ones are used up in an interval
export type MarkColor =
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'cyan'
  | 'orange'
  | 'pink';

export const COLOR_PROGRESSION: MarkColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'cyan',
  'orange',
  'pink',
];

export type DrawingTool = 'brush' | 'rect' | 'circle' | 'arrow';

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

  // Generative Replace / V2V Synthesis
  generativePrompt?: string;
  generativeStyle?: 'cyber' | 'fire' | 'watercolor' | 'hologram' | 'gold_aura';
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
}

export interface ColorGroupSummary {
  color: MarkColor;
  count: number;
  combinedBbox: BoundingBox;
  tools: DrawingTool[];
  isMotionTracked: boolean;
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

export const MARK_COLORS: Record<
  MarkColor,
  {
    name: string;
    hex: string;
    fillRgba: string;
    borderHex: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  red: {
    name: 'Red',
    hex: '#b82d23',
    fillRgba: 'rgba(184, 45, 35, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#b82d23] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  blue: {
    name: 'Blue',
    hex: '#234c7a',
    fillRgba: 'rgba(35, 76, 122, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#234c7a] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  green: {
    name: 'Green',
    hex: '#50793e',
    fillRgba: 'rgba(80, 121, 62, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#50793e] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  yellow: {
    name: 'Yellow',
    hex: '#c6923a',
    fillRgba: 'rgba(198, 146, 58, 0.28)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#c6923a] border-[#1d1a16]',
    badgeText: 'text-[#1d1a16]',
  },
  purple: {
    name: 'Purple',
    hex: '#7a3b69',
    fillRgba: 'rgba(122, 59, 105, 0.26)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#7a3b69] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  cyan: {
    name: 'Cyan',
    hex: '#2b7a78',
    fillRgba: 'rgba(43, 122, 120, 0.26)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#2b7a78] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  orange: {
    name: 'Orange',
    hex: '#cc5a2b',
    fillRgba: 'rgba(204, 90, 43, 0.26)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#cc5a2b] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  pink: {
    name: 'Pink',
    hex: '#b84a69',
    fillRgba: 'rgba(184, 74, 105, 0.26)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#b84a69] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
};

/**
 * Picks the next unused highlight color in the current timeframe:
 * Simple colors first (Red -> Blue -> Green -> Yellow),
 * followed by unusual colors (Purple -> Cyan -> Orange -> Pink) once simple ones are used up.
 */
export function getNextHighlightColor(
  timeframeAnnotations: ScreenAnnotation[]
): MarkColor {
  const used = new Set(timeframeAnnotations.map((a) => a.color));
  for (const color of COLOR_PROGRESSION) {
    if (!used.has(color)) return color;
  }
  // If all 8 colors are used in this timeframe, cycle based on count
  return COLOR_PROGRESSION[timeframeAnnotations.length % COLOR_PROGRESSION.length];
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
