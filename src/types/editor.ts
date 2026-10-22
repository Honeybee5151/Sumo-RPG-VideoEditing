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
  zoomScale?: number; // e.g., 1.8
  zoomEasing?: 'smooth' | 'instant' | 'spring';

  // Blur / Pixelate
  blurRadius?: number; // px, e.g., 16
  pixelBlockSize?: number; // px, e.g., 14
  invertMask?: boolean; // true = apply outside the drawn shape (e.g., background blur or color splash)

  // Spotlight
  dimOpacity?: number; // 0.0 to 1.0 (e.g. 0.7)

  // Color Grade
  saturation?: number; // 100 = normal, 0 = grayscale, 200 = super vibrant
  brightness?: number; // 100 = normal
  contrast?: number;   // 100 = normal
  hueRotate?: number;  // 0 to 360 deg
  sepia?: number;      // 0 to 100
  invert?: number;     // 0 to 100
  tintColor?: string;  // hex color
  tintOpacity?: number; // 0 to 1

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
  playbackRate?: number; // 0.25 to 4.0
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
  // Snapshot of the annotation geometry used by this effect so the user can clear the drawing board after applying
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
    hex: '#ef4444',
    fillRgba: 'rgba(239, 68, 68, 0.26)',
    borderHex: '#f87171',
    badgeBg: 'bg-red-500/20 border-red-500/50',
    badgeText: 'text-red-300',
  },
  blue: {
    name: 'Blue',
    hex: '#3b82f6',
    fillRgba: 'rgba(59, 130, 246, 0.26)',
    borderHex: '#60a5fa',
    badgeBg: 'bg-blue-500/20 border-blue-500/50',
    badgeText: 'text-blue-300',
  },
  green: {
    name: 'Green',
    hex: '#10b981',
    fillRgba: 'rgba(16, 185, 129, 0.26)',
    borderHex: '#34d399',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/50',
    badgeText: 'text-emerald-300',
  },
  yellow: {
    name: 'Yellow',
    hex: '#eab308',
    fillRgba: 'rgba(234, 179, 8, 0.26)',
    borderHex: '#facc15',
    badgeBg: 'bg-yellow-500/20 border-yellow-500/50',
    badgeText: 'text-yellow-300',
  },
};
