import {
  EXPORT_RESOLUTION_MAP,
  ExportResolutionPreset,
  VideoMetadataInfo,
} from '@/types/editor';

export function getOptimalVideoMimeType(hasAudio = true): {
  mimeType: string;
  extension: 'mp4' | 'webm';
  codecLabel: string;
} {
  const candidatesWithAudio: Array<{
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
      mimeType: 'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
      extension: 'mp4',
      codecLabel: 'MP4 (H.264 Baseline + AAC)',
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

  const candidatesVideoOnly: Array<{
    mimeType: string;
    extension: 'mp4' | 'webm';
    codecLabel: string;
  }> = [
    {
      mimeType: 'video/mp4;codecs="avc1.640033"',
      extension: 'mp4',
      codecLabel: 'MP4 (H.264 High Profile)',
    },
    {
      mimeType: 'video/mp4;codecs="avc1.42E01E"',
      extension: 'mp4',
      codecLabel: 'MP4 (H.264)',
    },
    {
      mimeType: 'video/mp4',
      extension: 'mp4',
      codecLabel: 'MP4 Container',
    },
    {
      mimeType: 'video/webm;codecs=vp9',
      extension: 'webm',
      codecLabel: 'WebM (VP9 HD)',
    },
    {
      mimeType: 'video/webm;codecs=h264',
      extension: 'webm',
      codecLabel: 'WebM (H.264)',
    },
    {
      mimeType: 'video/webm',
      extension: 'webm',
      codecLabel: 'WebM Standard',
    },
  ];

  const candidates = hasAudio ? candidatesWithAudio : candidatesVideoOnly;

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
