export type MarkColor = 'red' | 'blue' | 'green' | 'yellow';

export type DrawingTool = 'brush' | 'rect' | 'circle' | 'arrow';

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
}

export type EffectType =
  | 'zoom'
  | 'blur'
  | 'pixelate'
  | 'spotlight'
  | 'color_grade'
  | 'neon_glow'
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
}

/**
 * Mapped directly to the uploaded Sumo Brothers Color Palette Swatch Sheet:
 * - Red: Postbox Vermilion (#b82d23)
 * - Blue: Ai-iro Indigo (#234c7a / #4479a8)
 * - Green: Matcha Bamboo (#50793e)
 * - Yellow: Kitsune Gold Ochre (#c6923a)
 */
export const MARK_COLORS: Record<
  MarkColor,
  {
    name: string;
    jpLabel: string;
    hex: string;
    fillRgba: string;
    borderHex: string;
    badgeBg: string;
    badgeText: string;
  }
> = {
  red: {
    name: 'Red',
    jpLabel: 'Shu-iro',
    hex: '#b82d23',
    fillRgba: 'rgba(184, 45, 35, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#b82d23] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  blue: {
    name: 'Blue',
    jpLabel: 'Ai-iro',
    hex: '#234c7a',
    fillRgba: 'rgba(35, 76, 122, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#234c7a] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  green: {
    name: 'Green',
    jpLabel: 'Matcha',
    hex: '#50793e',
    fillRgba: 'rgba(80, 121, 62, 0.25)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#50793e] border-[#1d1a16]',
    badgeText: 'text-[#f5f2e8]',
  },
  yellow: {
    name: 'Yellow',
    jpLabel: 'Kitsune',
    hex: '#c6923a',
    fillRgba: 'rgba(198, 146, 58, 0.28)',
    borderHex: '#1d1a16',
    badgeBg: 'bg-[#c6923a] border-[#1d1a16]',
    badgeText: 'text-[#1d1a16]',
  },
};
