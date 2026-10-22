import {
  renderCompositedFrame,
  renderProceduralDemoScene,
} from '@/lib/canvasCompositor';
import {
  BuiltInSceneId,
  EXPORT_RESOLUTION_MAP,
  ExportResolutionPreset,
  ProjectFileSchema,
  ScreenAnnotation,
  TimelineEditItem,
  VideoMetadataInfo,
} from '@/types/editor';

export function getOptimalVideoMimeType(): {
  mimeType: string;
  extension: 'mp4' | 'webm';
  codecLabel: string;
} {
  const candidates: Array<{
    mimeType: string;
    extension: 'mp4' | 'webm';
    codecLabel: string;
  }> = [
    {
      mimeType: 'video/mp4;codecs="avc1.640033, mp4a.40.2"',
      extension: 'mp4',
      codecLabel: 'MP4 (H.264 High Profile + AAC)',
    },
    {
      mimeType: 'video/mp4',
      extension: 'mp4',
      codecLabel: 'MP4 Container',
    },
    {
      mimeType: 'video/webm;codecs=vp9,opus',
      extension: 'webm',
      codecLabel: 'WebM (VP9 + Opus HD)',
    },
    {
      mimeType: 'video/webm;codecs=h264,opus',
      extension: 'webm',
      codecLabel: 'WebM (H.264 + Opus)',
    },
    {
      mimeType: 'video/webm',
      extension: 'webm',
      codecLabel: 'WebM Standard',
    },
  ];

  if (typeof MediaRecorder !== 'undefined') {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mimeType)) {
        return c;
      }
    }
  }
  return {
    mimeType: 'video/webm',
    extension: 'webm',
    codecLabel: 'WebM Default',
  };
}

export function resolveExportDimensions(
  preset: ExportResolutionPreset,
  videoMeta: VideoMetadataInfo
): { width: number; height: number; label: string } {
  if (preset === 'native') {
    const w = videoMeta.width || 1920;
    const h = videoMeta.height || 1080;
    return {
      width: w,
      height: h,
      label: `Native Source (${w}×${h})`,
    };
  }

  const base = EXPORT_RESOLUTION_MAP[preset];
  const isPortrait = videoMeta.height > videoMeta.width;

  if (isPortrait) {
    return {
      width: base.height,
      height: base.width,
      label: `${preset.toUpperCase()} Vertical (${base.height}×${base.width})`,
    };
  }

  return {
    width: base.width,
    height: base.height,
    label: base.label,
  };
}

export function exportHighDefinitionSnapshotPng(options: {
  preset: ExportResolutionPreset;
  videoMeta: VideoMetadataInfo;
  videoElement: HTMLVideoElement | null;
  videoUrl: string | null;
  sceneId: BuiltInSceneId;
  currentTime: number;
  edits: TimelineEditItem[];
}) {
  const {
    preset,
    videoMeta,
    videoElement,
    videoUrl,
    sceneId,
    currentTime,
    edits,
  } = options;
  const { width, height } = resolveExportDimensions(preset, videoMeta);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = width;
  srcCanvas.height = height;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;

  const srcCtx = srcCanvas.getContext('2d');
  const outCtx = outCanvas.getContext('2d');
  if (!srcCtx || !outCtx) return;

  if (videoUrl && videoElement && videoElement.readyState >= 2) {
    srcCtx.drawImage(videoElement, 0, 0, width, height);
  } else {
    renderProceduralDemoScene(srcCtx, width, height, currentTime, sceneId);
  }

  renderCompositedFrame(outCtx, srcCanvas, width, height, currentTime, edits);

  outCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frame-${width}x${height}-${currentTime.toFixed(1)}s.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

/**
 * Exports a binary black/white segmentation mask PNG for AI V2V Inpainting pipelines
 * (such as Wan 2.1 VACE, SAM 2, or ComfyUI) from the user's drawn screen markings.
 */
export function exportBinaryMaskPng(options: {
  preset: ExportResolutionPreset;
  videoMeta: VideoMetadataInfo;
  annotations: ScreenAnnotation[];
}) {
  const { preset, videoMeta, annotations } = options;
  const { width, height } = resolveExportDimensions(preset, videoMeta);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const ctx = maskCanvas.getContext('2d');
  if (!ctx) return;

  // Black background = untouched video region
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // White foreground = AI inpainting target zone
  ctx.fillStyle = '#ffffff';
  for (const ann of annotations) {
    const b = ann.bbox;
    const x = b.x * width;
    const y = b.y * height;
    const w = b.width * width;
    const h = b.height * height;

    ctx.beginPath();
    if (ann.tool === 'circle') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (ann.tool === 'brush' && ann.points.length > 2) {
      const pts = ann.points;
      ctx.moveTo(pts[0].x * width, pts[0].y * height);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = ((pts[i].x + pts[i + 1].x) / 2) * width;
        const yc = ((pts[i].y + pts[i + 1].y) / 2) * height;
        ctx.quadraticCurveTo(pts[i].x * width, pts[i].y * height, xc, yc);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x * width, last.y * height);
      ctx.closePath();
    } else {
      ctx.roundRect(x, y, w, h, 8 * (width / 960));
    }
    ctx.fill();
  }

  maskCanvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-inpaint-mask-${width}x${height}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

export function exportProjectFile(data: {
  sceneId: BuiltInSceneId;
  intervalStart: number;
  intervalEnd: number;
  annotations: ScreenAnnotation[];
  edits: TimelineEditItem[];
}) {
  const payload: ProjectFileSchema = {
    version: '0.2.0',
    exportedAt: new Date().toISOString(),
    ...data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `video-project-${Date.now()}.chromacut.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
