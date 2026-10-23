'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Play,
  Pause,
  Upload,
  Download,
  Trash2,
  Undo2,
  Eye,
  EyeOff,
  Square,
  Circle,
  Brush,
  MoveUpRight,
  Repeat,
  Sliders,
  Clock,
  Layers,
  CheckCircle2,
  Settings,
  Film,
  RotateCcw,
  Wand2,
  Camera,
  FolderOpen,
  Save,
  SplitSquareHorizontal,
  Volume2,
  VolumeX,
  Compass,
  Zap,
  BookOpen,
  Music,
  Scissors,
  Star,
  Image as ImageIcon,
  Plus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AI_PROVIDER_CATALOG,
  AiProviderId,
  AiSettingsConfig,
  BuiltInSceneId,
  COLOR_PROGRESSION,
  DrawingTool,
  EXPORT_RESOLUTION_MAP,
  ExportConfig,
  ExportResolutionPreset,
  getNextHighlightColor,
  isAnnotationInTimeframe,
  MARK_COLORS,
  MarkColor,
  NormalizedPoint,
  ProjectFileSchema,
  ScreenAnnotation,
  TimelineEditItem,
  VideoMetadataInfo,
} from '@/types/editor';
import {
  computeBoundingBox,
  getInterpolatedAnnotations,
  summarizeColorGroups,
} from '@/lib/editCompiler';
import {
  renderCompositedFrame,
  renderProceduralDemoScene,
} from '@/lib/canvasCompositor';
import {
  exportBinaryMaskPng,
  exportHighDefinitionSnapshotPng,
  exportProjectFile,
  getOptimalVideoMimeType,
  resolveExportDimensions,
} from '@/lib/hdExporter';
import { computeTrackedKeyframe } from '@/lib/autoTracker';
import {
  extractAudioPeaksFromFile,
  generateProceduralWaveform,
  playAiEffectSoundCue,
} from '@/lib/audioEngine';
import {
  detectMediaCategory,
  loadPersistedFavorites,
  MediaAssetItem,
  MediaCategory,
  removeFavoriteFromDb,
  saveFavoriteToDb,
} from '@/lib/mediaLibraryStore';
import type { SuggestedInterval } from '@/app/api/ai-analyze/route';

const DEFAULT_DURATION = 12;

function CornerRivets() {
  return (
    <>
      <span className="pointer-events-none absolute top-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-[#1d1a16]" />
      <span className="pointer-events-none absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#1d1a16]" />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 w-1.5 h-1.5 rounded-full bg-[#1d1a16]" />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#1d1a16]" />
    </>
  );
}

export default function VideoEditorStudio() {
  // Video / Image / Sound playback & source state
  const [sceneId, setSceneId] = useState<BuiltInSceneId>('scenic_valley');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('No media loaded');
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopIntervalOnly, setLoopIntervalOnly] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Left Media Library State (Current Project & Persistent Favorites across sessions)
  const [mediaLibrary, setMediaLibrary] = useState<MediaAssetItem[]>([]);
  const [libraryScope, setLibraryScope] = useState<'project' | 'favorites'>('project');
  const [libraryCategory, setLibraryCategory] = useState<MediaCategory>('video');

  // Timeline Cut Points (placed on the Red Playhead) & Deleted Segments
  const [splitPoints, setSplitPoints] = useState<number[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<{
    startTime: number;
    endTime: number;
  } | null>(null);
  const [cuts, setCuts] = useState<Array<{ id: string; startTime: number; endTime: number }>>([]);
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [timelineScrollStart, setTimelineScrollStart] = useState<number>(0);

  const [videoMeta, setVideoMeta] = useState<VideoMetadataInfo>({
    width: 1920,
    height: 1080,
    duration: DEFAULT_DURATION,
    aspectRatioLabel: '16:9 HD',
    hasAudio: false,
    isCustomVideo: false,
  });

  // Interval selection [startTime, endTime] & inline badge editor
  const [intervalStart, setIntervalStart] = useState<number>(1.0);
  const [intervalEnd, setIntervalEnd] = useState<number>(6.5);
  const [isEditingIntervalBadge, setIsEditingIntervalBadge] = useState<boolean>(false);
  const [draftIntervalStart, setDraftIntervalStart] = useState<string>('1.0');
  const [draftIntervalEnd, setDraftIntervalEnd] = useState<string>('6.5');

  // Screen Drawing / Multi-Color Annotation state
  const [activeColor, setActiveColor] = useState<MarkColor>('red');
  const [focusedColor, setFocusedColor] = useState<MarkColor | 'all'>('all');
  const [activeTool, setActiveTool] = useState<DrawingTool>('rect');
  const [annotations, setAnnotations] = useState<ScreenAnnotation[]>([]);
  const [currentStroke, setCurrentStroke] = useState<NormalizedPoint[] | null>(null);
  const [showMarkingsOverlay, setShowMarkingsOverlay] = useState<boolean>(true);

  // Before / After Comparison Split Wipe
  const [splitCompareEnabled, setSplitCompareEnabled] = useState<boolean>(false);
  const [splitCompareX, setSplitCompareX] = useState<number>(0.5);

  // AI Prompt, Per-Color AI Prompts, Timeline Edits, & Full Undo/Redo History
  const [prompt, setPrompt] = useState<string>('');
  const [colorPrompts, setColorPrompts] = useState<Partial<Record<MarkColor, string>>>({});
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [edits, setEdits] = useState<TimelineEditItem[]>([]);
  const [undoStack, setUndoStack] = useState<
    Array<{
      annotations: ScreenAnnotation[];
      edits: TimelineEditItem[];
      cuts: Array<{ id: string; startTime: number; endTime: number }>;
      splitPoints: number[];
      intervalStart: number;
      intervalEnd: number;
      focusedColor: MarkColor | 'all';
      selectedEditId: string | null;
      selectedSegment: { startTime: number; endTime: number } | null;
      mediaLibrary: MediaAssetItem[];
      videoUrl: string | null;
      activeImageUrl: string | null;
      activeAudioUrl: string | null;
      videoFileName: string;
      duration: number;
    }>
  >([]);
  const [redoStack, setRedoStack] = useState<
    Array<{
      annotations: ScreenAnnotation[];
      edits: TimelineEditItem[];
      cuts: Array<{ id: string; startTime: number; endTime: number }>;
      splitPoints: number[];
      intervalStart: number;
      intervalEnd: number;
      focusedColor: MarkColor | 'all';
      selectedEditId: string | null;
      selectedSegment: { startTime: number; endTime: number } | null;
      mediaLibrary: MediaAssetItem[];
      videoUrl: string | null;
      activeImageUrl: string | null;
      activeAudioUrl: string | null;
      videoFileName: string;
      duration: number;
    }>
  >([]);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [suggestedIntervals, setSuggestedIntervals] = useState<SuggestedInterval[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Modals: Cloud Settings, HD Export Studio, & AI Prompt Grimoire
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showGrimoireModal, setShowGrimoireModal] = useState<boolean>(false);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(() =>
    Array.from({ length: 96 }, () => 0.08)
  );
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [falApiKey, setFalApiKey] = useState<string>('');
  const [aiSettings, setAiSettings] = useState<AiSettingsConfig>({
    provider: 'auto',
    model: 'auto',
    apiKeys: {},
    customBaseUrl: 'http://localhost:11434/v1/chat/completions',
    customContextPrompt: '',
  });
  const [aiTestStatus, setAiTestStatus] = useState<{
    loading: boolean;
    ok?: boolean;
    message?: string;
  }>({ loading: false });

  // High-Definition Export Configuration & Progress
  const [exportConfig, setExportConfig] = useState<ExportConfig>({
    resolution: '1080p',
    fps: 60,
    bitrateMbps: 24,
    range: 'full',
    includeAudio: true,
  });
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);

  // Refs for rendering loop & interaction
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const draggingHandleRef = useRef<'start' | 'end' | 'playhead' | null>(null);
  const draggingColorEdgeRef = useRef<{
    color: MarkColor;
    edge: 'start' | 'end' | 'move';
    initialStart?: number;
    initialEnd?: number;
    grabTime?: number;
  } | null>(null);
  const canvasTransformRef = useRef<{
    annId: string;
    color: MarkColor;
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
    startPt: NormalizedPoint;
    initialBbox: {
      x: number;
      y: number;
      width: number;
      height: number;
      cx: number;
      cy: number;
    };
    initialPoints: NormalizedPoint[];
  } | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  // Load persisted Favorites across browser sessions on mount
  useEffect(() => {
    loadPersistedFavorites().then((favs) => {
      if (favs.length > 0) {
        setMediaLibrary((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          return [...prev, ...favs.filter((f) => !existingIds.has(f.id))];
        });
      }
    });
    try {
      const savedAi = window.localStorage.getItem('chromacut_ai_settings_v2');
      if (savedAi) {
        const parsed = JSON.parse(savedAi) as Partial<AiSettingsConfig>;
        setAiSettings((prev) => ({
          ...prev,
          ...parsed,
          apiKeys: { ...prev.apiKeys, ...(parsed.apiKeys || {}) },
        }));
      }
    } catch {
      // ignore storage parse issues
    }

    // Auto-update check tied to GitHub Releases
    const checkAndApplyReleaseUpdate = async () => {
      try {
        const res = await fetch('/api/auto-update');
        const data = await res.json();
        if (data?.updateAvailable) {
          await fetch('/api/auto-update', { method: 'POST' });
        }
      } catch {
        // ignore network issues when offline
      }
    };
    checkAndApplyReleaseUpdate();
    const updateTimer = window.setInterval(
      checkAndApplyReleaseUpdate,
      15 * 60 * 1000
    );
    return () => window.clearInterval(updateTimer);
  }, []);

  const updateAiSettings = useCallback(
    (updater: (prev: AiSettingsConfig) => AiSettingsConfig) => {
      setAiSettings((prev) => {
        const next = updater(prev);
        try {
          window.localStorage.setItem(
            'chromacut_ai_settings_v2',
            JSON.stringify(next)
          );
        } catch {
          // ignore storage write issues
        }
        return next;
      });
    },
    []
  );

  const handleTestAiConnection = async () => {
    setAiTestStatus({ loading: true });
    try {
      const activeKey =
        aiSettings.apiKeys[aiSettings.provider] ||
        aiSettings.apiKeys.auto ||
        geminiApiKey ||
        '';
      const res = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'test',
          provider: aiSettings.provider,
          model: aiSettings.model,
          apiKey: activeKey,
          apiKeys: aiSettings.apiKeys,
          geminiApiKey,
          customBaseUrl: aiSettings.customBaseUrl,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setAiTestStatus({
          loading: false,
          ok: true,
          message: data.message || `Connected to ${data.provider}!`,
        });
      } else {
        setAiTestStatus({
          loading: false,
          ok: false,
          message: data.error || 'Connection test failed.',
        });
      }
    } catch (err) {
      setAiTestStatus({
        loading: false,
        ok: false,
        message: err instanceof Error ? err.message : 'Network error testing API.',
      });
    }
  };

  const recordHistorySnapshot = useCallback(() => {
    setUndoStack((stack) => [
      ...stack.slice(-30),
      {
        annotations,
        edits,
        cuts,
        splitPoints,
        intervalStart,
        intervalEnd,
        focusedColor,
        selectedEditId,
        selectedSegment,
        mediaLibrary,
        videoUrl,
        activeImageUrl,
        activeAudioUrl,
        videoFileName,
        duration,
      },
    ]);
    setRedoStack([]);
  }, [
    annotations,
    edits,
    cuts,
    splitPoints,
    intervalStart,
    intervalEnd,
    focusedColor,
    selectedEditId,
    selectedSegment,
    mediaLibrary,
    videoUrl,
    activeImageUrl,
    activeAudioUrl,
    videoFileName,
    duration,
  ]);

  const pushEditsWithUndo = useCallback(
    (updater: (prev: TimelineEditItem[]) => TimelineEditItem[]) => {
      recordHistorySnapshot();
      setEdits((prev) => updater(prev));
    },
    [recordHistorySnapshot]
  );

  const deleteColor = useCallback(
    (color: MarkColor) => {
      recordHistorySnapshot();
      setAnnotations((prev) => prev.filter((a) => a.color !== color));
      setEdits((prev) => prev.filter((e) => e.targetColor !== color));
      if (focusedColor === color) {
        setFocusedColor('all');
      }
    },
    [focusedColor, recordHistorySnapshot]
  );

  // Cut right on the Red Playhead (`currentTime`) — max 2 cuts at a time; clicking Cut a 3rd time removes the 1st cut
  const handleCutInterval = useCallback(() => {
    const t = Number(
      Math.max(0.05, Math.min(duration - 0.05, currentTime)).toFixed(2)
    );
    recordHistorySnapshot();
    const filtered = splitPoints.filter((p) => Math.abs(p - t) > 0.05);
    const nextSplits = [...filtered, t].slice(-2);
    setSplitPoints(nextSplits);

    if (nextSplits.length === 2) {
      const low = Math.min(nextSplits[0], nextSplits[1]);
      const high = Math.max(nextSplits[0], nextSplits[1]);
      setSelectedSegment({
        startTime: low,
        endTime: high,
      });
    } else {
      setSelectedSegment({
        startTime: 0,
        endTime: t,
      });
    }
  }, [currentTime, duration, recordHistorySnapshot, splitPoints]);

  // Delete the selected cut segment (or segment under the Red Playhead / focused Box or Dot)
  const handleDeleteSelected = useCallback(() => {
    if (selectedSegment) {
      recordHistorySnapshot();
      setCuts((prev) => [
        ...prev,
        {
          id: `cut-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          startTime: selectedSegment.startTime,
          endTime: selectedSegment.endTime,
        },
      ]);
      setSplitPoints([]);
      setSelectedSegment(null);
      return;
    }

    if (splitPoints.length > 0) {
      const sortedSplits = [...splitPoints].sort((a, b) => a - b);
      const boundaries = [0, ...sortedSplits, duration];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const s = boundaries[i];
        const e = boundaries[i + 1];
        if (currentTime >= s - 0.02 && currentTime <= e + 0.02) {
          recordHistorySnapshot();
          setCuts((prev) => [
            ...prev,
            {
              id: `cut-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              startTime: s,
              endTime: e,
            },
          ]);
          setSplitPoints([]);
          setSelectedSegment(null);
          return;
        }
      }
    }

    if (focusedColor !== 'all') {
      deleteColor(focusedColor);
      return;
    }

    const s = Number(Math.max(0, Math.min(intervalStart, intervalEnd - 0.2)).toFixed(2));
    const e = Number(Math.min(duration, Math.max(intervalEnd, s + 0.2)).toFixed(2));
    recordHistorySnapshot();
    setCuts((prev) => [
      ...prev,
      {
        id: `cut-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        startTime: s,
        endTime: e,
      },
    ]);
  }, [
    selectedSegment,
    splitPoints,
    duration,
    currentTime,
    focusedColor,
    intervalStart,
    intervalEnd,
    recordHistorySnapshot,
    deleteColor,
  ]);

  const handleUndoEdit = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((r) => [
      ...r.slice(-30),
      {
        annotations,
        edits,
        cuts,
        splitPoints,
        intervalStart,
        intervalEnd,
        focusedColor,
        selectedEditId,
        selectedSegment,
        mediaLibrary,
        videoUrl,
        activeImageUrl,
        activeAudioUrl,
        videoFileName,
        duration,
      },
    ]);
    setUndoStack((s) => s.slice(0, -1));
    setAnnotations(previous.annotations);
    setEdits(previous.edits);
    setCuts(previous.cuts);
    setSplitPoints(previous.splitPoints);
    setIntervalStart(previous.intervalStart);
    setIntervalEnd(previous.intervalEnd);
    setFocusedColor(previous.focusedColor);
    setSelectedEditId(previous.selectedEditId);
    setSelectedSegment(previous.selectedSegment);
    setMediaLibrary(previous.mediaLibrary);
    setVideoUrl(previous.videoUrl);
    setActiveImageUrl(previous.activeImageUrl);
    setActiveAudioUrl(previous.activeAudioUrl);
    setVideoFileName(previous.videoFileName);
    setDuration(previous.duration);
  }, [
    undoStack,
    annotations,
    edits,
    cuts,
    splitPoints,
    intervalStart,
    intervalEnd,
    focusedColor,
    selectedEditId,
    selectedSegment,
    mediaLibrary,
    videoUrl,
    activeImageUrl,
    activeAudioUrl,
    videoFileName,
    duration,
  ]);

  const handleRedoEdit = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [
      ...s.slice(-30),
      {
        annotations,
        edits,
        cuts,
        splitPoints,
        intervalStart,
        intervalEnd,
        focusedColor,
        selectedEditId,
        selectedSegment,
        mediaLibrary,
        videoUrl,
        activeImageUrl,
        activeAudioUrl,
        videoFileName,
        duration,
      },
    ]);
    setRedoStack((r) => r.slice(0, -1));
    setAnnotations(next.annotations);
    setEdits(next.edits);
    setCuts(next.cuts);
    setSplitPoints(next.splitPoints);
    setIntervalStart(next.intervalStart);
    setIntervalEnd(next.intervalEnd);
    setFocusedColor(next.focusedColor);
    setSelectedEditId(next.selectedEditId);
    setSelectedSegment(next.selectedSegment);
    setMediaLibrary(next.mediaLibrary);
    setVideoUrl(next.videoUrl);
    setActiveImageUrl(next.activeImageUrl);
    setActiveAudioUrl(next.activeAudioUrl);
    setVideoFileName(next.videoFileName);
    setDuration(next.duration);
  }, [
    redoStack,
    annotations,
    edits,
    cuts,
    splitPoints,
    intervalStart,
    intervalEnd,
    focusedColor,
    selectedEditId,
    selectedSegment,
    mediaLibrary,
    videoUrl,
    activeImageUrl,
    activeAudioUrl,
    videoFileName,
    duration,
  ]);

  // Keyboard shortcuts (Space, C to Cut on red playhead, Delete/Backspace, Cmd/Ctrl+Z Undo, Cmd/Ctrl+X or Shift+Z/Y Redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = (target as HTMLInputElement | null)?.type;
      const isTextInput =
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' &&
          inputType !== 'range' &&
          inputType !== 'checkbox' &&
          inputType !== 'button');

      // Allow Ctrl+Z / Ctrl+X / Ctrl+Y even when focused on sliders, checkboxes, or empty inputs!
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const textVal = (target as HTMLInputElement | null)?.value ?? '';
        if (!isTextInput || textVal.length === 0) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedoEdit();
          } else {
            handleUndoEdit();
          }
          return;
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'x' || e.key.toLowerCase() === 'y')
      ) {
        const hasSelection =
          isTextInput &&
          typeof (target as HTMLInputElement).selectionStart === 'number' &&
          (target as HTMLInputElement).selectionStart !==
            (target as HTMLInputElement).selectionEnd;
        if (!hasSelection) {
          e.preventDefault();
          handleRedoEdit();
          return;
        }
      }

      if (isTextInput || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteSelected();
      } else if (e.key === '[') {
        recordHistorySnapshot();
        setIntervalStart(Math.min(currentTime, intervalEnd - 0.3));
      } else if (e.key === ']') {
        recordHistorySnapshot();
        setIntervalEnd(Math.max(currentTime, intervalStart + 0.3));
      } else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) {
        handleCutInterval();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentTime,
    intervalStart,
    intervalEnd,
    recordHistorySnapshot,
    handleCutInterval,
    handleDeleteSelected,
    handleUndoEdit,
    handleRedoEdit,
  ]);

  const getActivePlaybackRate = useCallback(
    (t: number) => {
      const speedEdit = edits.find(
        (e) =>
          e.enabled &&
          e.effectType === 'speed' &&
          t >= e.startTime &&
          t <= e.endTime
      );
      if (!speedEdit) return { rate: 1.0, freeze: false, freezeTime: t };
      return {
        rate: speedEdit.params.playbackRate ?? 1.0,
        freeze: Boolean(speedEdit.params.freezeFrame),
        freezeTime: speedEdit.startTime,
      };
    },
    [edits]
  );

  // Helper to skip past any cut segments [cut.startTime, cut.endTime]
  const skipCutSegments = useCallback(
    (t: number): number => {
      let nextT = t;
      const sortedCuts = [...cuts].sort((a, b) => a.startTime - b.startTime);
      for (const c of sortedCuts) {
        if (nextT >= c.startTime && nextT < c.endTime) {
          nextT = c.endTime;
        }
      }
      return nextT >= duration ? 0 : nextT;
    },
    [cuts, duration]
  );

  // Helper to draw any resolution/aspect-ratio video or image centered (letterboxed/pillarboxed) inside the fixed 1280x720 stage
  const drawMediaContain = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      media: HTMLVideoElement | HTMLImageElement,
      destW: number,
      destH: number,
      srcW: number,
      srcH: number
    ) => {
      ctx.fillStyle = '#181614';
      ctx.fillRect(0, 0, destW, destH);
      const validW = srcW > 0 ? srcW : destW;
      const validH = srcH > 0 ? srcH : destH;
      const scale = Math.min(destW / validW, destH / validH);
      const drawW = validW * scale;
      const drawH = validH * scale;
      const offsetX = (destW - drawW) / 2;
      const offsetY = (destH - drawH) / 2;
      ctx.drawImage(media, offsetX, offsetY, drawW, drawH);
    },
    []
  );

  // 60 FPS Render & Playback Loop
  useEffect(() => {
    let animationFrameId: number;

    const renderTick = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      }
      const dt = Math.min(0.1, (now - lastFrameTimeRef.current) / 1000);
      lastFrameTimeRef.current = now;

      if (isPlaying && !isExporting) {
        if (videoUrl && videoRef.current) {
          const vid = videoRef.current;
          let next = skipCutSegments(vid.currentTime);
          if (Math.abs(next - vid.currentTime) > 0.05) {
            vid.currentTime = next;
          }
          if (loopIntervalOnly) {
            if (next >= intervalEnd || next < intervalStart) {
              vid.currentTime = intervalStart;
              next = intervalStart;
            }
          } else if (next >= duration - 0.05) {
            vid.currentTime = 0;
            next = 0;
          }
          setCurrentTime(next);
        } else {
          setCurrentTime((prev) => {
            const { rate, freeze } = getActivePlaybackRate(prev);
            const effectiveRate = freeze ? 1.0 : rate;
            let next = skipCutSegments(prev + dt * effectiveRate);

            if (loopIntervalOnly) {
              if (next > intervalEnd || next < intervalStart) {
                next = intervalStart;
              }
            } else if (next >= duration) {
              next = 0;
            }
            return next;
          });
        }
      }

      const displayCanvas = displayCanvasRef.current;
      if (displayCanvas && !isExporting) {
        if (!sourceCanvasRef.current) {
          sourceCanvasRef.current = document.createElement('canvas');
        }
        const srcCanvas = sourceCanvasRef.current;
        const width = 1280;
        const height = 720;
        if (srcCanvas.width !== width) srcCanvas.width = width;
        if (srcCanvas.height !== height) srcCanvas.height = height;
        if (displayCanvas.width !== width) displayCanvas.width = width;
        if (displayCanvas.height !== height) displayCanvas.height = height;

        const srcCtx = srcCanvas.getContext('2d');
        const mainCtx = displayCanvas.getContext('2d');

        if (srcCtx && mainCtx) {
          if (videoUrl) {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              drawMediaContain(
                srcCtx,
                videoRef.current,
                width,
                height,
                videoRef.current.videoWidth || width,
                videoRef.current.videoHeight || height
              );
            }
          } else if (activeImageUrl && imageRef.current && imageRef.current.complete) {
            drawMediaContain(
              srcCtx,
              imageRef.current,
              width,
              height,
              imageRef.current.naturalWidth || width,
              imageRef.current.naturalHeight || height
            );
          } else {
            // Clean neutral empty canvas when no media is loaded (no procedural preset scenes!)
            srcCtx.fillStyle = '#181614';
            srcCtx.fillRect(0, 0, width, height);
          }

          renderCompositedFrame(
            mainCtx,
            srcCanvas,
            width,
            height,
            currentTime,
            edits,
            splitCompareEnabled ? splitCompareX : undefined
          );
        }
      }

      animationFrameId = requestAnimationFrame(renderTick);
    };

    animationFrameId = requestAnimationFrame(renderTick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isPlaying,
    isExporting,
    currentTime,
    duration,
    intervalStart,
    intervalEnd,
    loopIntervalOnly,
    videoUrl,
    activeImageUrl,
    edits,
    splitCompareEnabled,
    splitCompareX,
    getActivePlaybackRate,
    skipCutSegments,
    drawMediaContain,
  ]);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid && videoUrl) {
      const { rate, freeze } = getActivePlaybackRate(currentTime);
      vid.playbackRate = freeze ? 0.0625 : rate;
      vid.muted = isMuted;

      if (isPlaying) {
        if (vid.paused) {
          vid.play().catch(() => {});
        }
      } else {
        if (!vid.paused) {
          vid.pause();
        }
        if (Math.abs(vid.currentTime - currentTime) > 0.04 && !vid.seeking) {
          vid.currentTime = currentTime;
        }
      }
    }

    const aud = audioRef.current;
    if (aud && activeAudioUrl) {
      aud.muted = isMuted;
      if (isPlaying) {
        if (aud.paused) {
          aud.play().catch(() => {});
        }
      } else {
        if (!aud.paused) {
          aud.pause();
        }
        if (Math.abs(aud.currentTime - currentTime) > 0.08) {
          aud.currentTime = Math.min(aud.duration || duration, currentTime);
        }
      }
    }
  }, [isPlaying, videoUrl, activeAudioUrl, currentTime, isMuted, duration, getActivePlaybackRate]);

  const activateMediaAsset = useCallback(
    (asset: MediaAssetItem, recordUndo = true) => {
      if (recordUndo) {
        recordHistorySnapshot();
      }
      if (asset.category === 'video') {
        setActiveImageUrl(null);
        setVideoUrl(asset.url);
        setVideoFileName(asset.name);
        setIsMuted(false);
        setCurrentTime(0);
        setTimelineZoom(1);
        setTimelineScrollStart(0);
        setAnnotations([]);
        setEdits([]);
        setCuts([]);
        setSplitPoints([]);
        setSelectedSegment(null);
        setSelectedEditId(null);
        setFocusedColor('all');
        if (asset.blob instanceof File) {
          extractAudioPeaksFromFile(asset.blob, 96).then((peaks) =>
            setWaveformPeaks(peaks)
          );
        }
      } else if (asset.category === 'image') {
        setVideoUrl(null);
        setActiveImageUrl(asset.url);
        setVideoFileName(asset.name);
        setDuration(10);
        setCurrentTime(0);
        setTimelineZoom(1);
        setTimelineScrollStart(0);
        setIntervalStart(0);
        setIntervalEnd(5);
        setAnnotations([]);
        setEdits([]);
        setCuts([]);
        setSplitPoints([]);
        setSelectedSegment(null);
        setSelectedEditId(null);
        setFocusedColor('all');
      } else if (asset.category === 'audio') {
        setActiveAudioUrl(asset.url);
        setIsMuted(false);
        if (asset.blob instanceof File) {
          extractAudioPeaksFromFile(asset.blob, 96).then((peaks) =>
            setWaveformPeaks(peaks)
          );
        }
      }
    },
    [recordHistorySnapshot]
  );

  const toggleFavoriteAsset = useCallback(
    (assetId: string) => {
      recordHistorySnapshot();
      setMediaLibrary((prev) =>
        prev
          .map((item) => {
            if (item.id !== assetId) return item;
            const nextFav = !item.isFavorite;
            const updated = { ...item, isFavorite: nextFav };
            if (nextFav) {
              saveFavoriteToDb(updated);
            } else {
              removeFavoriteFromDb(updated.id);
            }
            return updated;
          })
          .filter((item) => item.inCurrentProject || item.isFavorite)
      );
    },
    [recordHistorySnapshot]
  );

  // Universal File Import Handler (Videos, Images, Sound, or .chromacut.json Project Files)
  const processImportedFile = (file: File) => {
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as ProjectFileSchema;
          if (parsed.edits && Array.isArray(parsed.edits)) {
            recordHistorySnapshot();
            if (parsed.sceneId) setSceneId(parsed.sceneId);
            setIntervalStart(parsed.intervalStart ?? 1.0);
            setIntervalEnd(parsed.intervalEnd ?? 6.0);
            setAnnotations(parsed.annotations ?? []);
            setEdits(parsed.edits);
          }
        } catch {
          // ignore invalid json
        }
      };
      reader.readAsText(file);
      return;
    }

    recordHistorySnapshot();
    const category = detectMediaCategory(file);
    const url = URL.createObjectURL(file);
    const addingDirectlyToFavorites = libraryScope === 'favorites';
    const newItem: MediaAssetItem = {
      id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      category,
      url,
      blob: file,
      isFavorite: addingDirectlyToFavorites,
      inCurrentProject: !addingDirectlyToFavorites,
      createdAt: Date.now(),
    };

    if (addingDirectlyToFavorites) {
      saveFavoriteToDb(newItem);
    }

    setMediaLibrary((prev) => [newItem, ...prev]);
    setLibraryCategory(category);
    activateMediaAsset(newItem, false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => processImportedFile(file));
      e.target.value = '';
    }
  };

  const handleStageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => processImportedFile(file));
    }
  };

  // Load 1-click Multi-Color Showcase Preset
  const loadShowcasePreset = () => {
    const sampleAnnotations: ScreenAnnotation[] = [
      {
        id: 'demo-red-car',
        color: 'red',
        tool: 'rect',
        points: [
          { x: 0.65, y: 0.63 },
          { x: 0.87, y: 0.8 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.65, y: 0.63, width: 0.22, height: 0.17, cx: 0.76, cy: 0.715 },
        createdAtTime: 2.0,
        startTime: 1.0,
        endTime: 6.5,
      },
      {
        id: 'demo-blue-tower',
        color: 'blue',
        tool: 'rect',
        points: [
          { x: 0.4, y: 0.22 },
          { x: 0.6, y: 0.74 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.4, y: 0.22, width: 0.2, height: 0.52, cx: 0.5, cy: 0.48 },
        createdAtTime: 2.0,
        startTime: 1.0,
        endTime: 6.5,
      },
      {
        id: 'demo-green-balloon',
        color: 'green',
        tool: 'circle',
        points: [
          { x: 0.13, y: 0.16 },
          { x: 0.25, y: 0.4 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.13, y: 0.16, width: 0.12, height: 0.24, cx: 0.19, cy: 0.28 },
        createdAtTime: 2.0,
        startTime: 1.0,
        endTime: 6.5,
      },
      {
        id: 'demo-interval2-red',
        color: 'red',
        tool: 'rect',
        points: [
          { x: 0.65, y: 0.63 },
          { x: 0.87, y: 0.8 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.65, y: 0.63, width: 0.22, height: 0.17, cx: 0.76, cy: 0.715 },
        createdAtTime: 7.5,
        startTime: 7.0,
        endTime: 10.5,
      },
    ];

    setAnnotations(sampleAnnotations);
    setIntervalStart(1.0);
    setIntervalEnd(6.5);
    setCurrentTime(2.0);
    setActiveColor('yellow'); // Since Red, Blue, Green are used in [1.0s - 6.5s], Yellow is queued next!
    setPrompt(
      'Add text "VINTAGE COUPE" on the red area, make the green area glow gold, and manga ink on the blue area'
    );

    const demoEdits: TimelineEditItem[] = [
      {
        id: 'demo-edit-1',
        prompt: 'Add text "VINTAGE COUPE" on the red area',
        summary: 'Callout "VINTAGE COUPE" @ RED',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'text_overlay',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: {
          text: 'VINTAGE COUPE',
          textStyle: 'callout',
          textColor: '#1d1a16',
          fontSize: 28,
        },
        enabled: true,
        aiProvider: 'Demo Preset',
      },
      {
        id: 'demo-edit-2',
        prompt: 'Add viewfinder brackets on the red area',
        summary: 'Brackets @ RED',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'callout_shape',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: {
          shapeType: 'brackets',
          shapeColor: '#b82d23',
        },
        enabled: true,
        aiProvider: 'Demo Preset',
      },
      {
        id: 'demo-edit-3',
        prompt: 'Make the green area glow gold',
        summary: 'Warm Glow (#c6923a) → GREEN',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'neon_glow',
        targetColor: 'green',
        annotations: [sampleAnnotations[2]],
        params: { glowColor: '#c6923a', glowIntensity: 26, pulse: true },
        enabled: true,
        aiProvider: 'Demo Preset',
      },
      {
        id: 'demo-edit-4',
        prompt: 'Manga halftone ink on the blue area',
        summary: 'Manga Halftone Ink → BLUE',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'halftone_ink',
        targetColor: 'blue',
        annotations: [sampleAnnotations[1]],
        params: {
          dotSpacing: 6,
          inkColor: '#1d1a16',
          paperColor: '#ece5d3',
          invertMask: false,
        },
        enabled: true,
        aiProvider: 'Demo Preset',
      },
      {
        id: 'demo-edit-5',
        prompt: 'Zoom into the red area from 7s to 10.5s',
        summary: 'Zoom 1.85x → RED',
        startTime: 7.0,
        endTime: 10.5,
        effectType: 'zoom',
        targetColor: 'red',
        annotations: [sampleAnnotations[3]],
        params: { zoomScale: 1.85, zoomEasing: 'smooth' },
        enabled: true,
        aiProvider: 'Demo Preset',
      },
    ];

    pushEditsWithUndo(() => demoEdits);
    setSelectedEditId(demoEdits[0].id);
    setIsPlaying(true);
    setStatusMessage(
      'Loaded Sample Timeframes! Click [1.0s–6.5s] or [7.0s–10.5s] on the timeline to see each timeframe’s saved highlights.'
    );
  };

  // AI Smart Interval Discovery
  const handleSuggestIntervals = async () => {
    try {
      setStatusMessage('AI scanning timeline for optimal editing intervals...');
      const res = await fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      });
      const data = await res.json();
      if (data.suggestions) {
        setSuggestedIntervals(data.suggestions);
        setStatusMessage(
          `AI discovered ${data.suggestions.length} recommended timeframes! Click any badge below to jump.`
        );
      }
    } catch {
      setStatusMessage('Could not analyze intervals.');
    }
  };

  // Highlights visible at the current playhead timestamp (`currentTime`), plus the actively focused color while paused so the Red Playhead and color bar are 100% independent
  const timeframeAnnotations = annotations.filter((a) => {
    const s = a.startTime ?? 0;
    const e = a.endTime ?? duration;
    return (
      (currentTime >= s - 0.05 && currentTime <= e + 0.05) ||
      (!isPlaying && focusedColor !== 'all' && a.color === focusedColor)
    );
  });

  // Automatically pick the next unused distinct color whenever the timeframe changes
  useEffect(() => {
    setActiveColor(getNextHighlightColor(annotations));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalStart, intervalEnd]);

  // AI Optical Patch Auto-Tracker across [intervalStart, intervalEnd]
  const handleAutoTrackActiveColor = () => {
    const targetTrackColor =
      timeframeAnnotations.some((a) => a.color === activeColor)
        ? activeColor
        : timeframeAnnotations[timeframeAnnotations.length - 1]?.color ?? activeColor;
    const colorAnns = timeframeAnnotations.filter(
      (a) => a.color === targetTrackColor
    );
    if (colorAnns.length === 0 || !sourceCanvasRef.current) {
      setStatusMessage(
        'Draw a highlight box around an object in this timeframe first, then click AI Track!'
      );
      return;
    }

    const baseAnn = colorAnns[colorAnns.length - 1];
    const startCanvas = document.createElement('canvas');
    startCanvas.width = 640;
    startCanvas.height = 360;
    const endCanvas = document.createElement('canvas');
    endCanvas.width = 640;
    endCanvas.height = 360;

    const sCtx = startCanvas.getContext('2d');
    const eCtx = endCanvas.getContext('2d');
    if (!sCtx || !eCtx) return;

    if (videoUrl && videoRef.current && videoRef.current.readyState >= 2) {
      sCtx.drawImage(videoRef.current, 0, 0, 640, 360);
      eCtx.drawImage(videoRef.current, 0, 0, 640, 360);
    } else {
      renderProceduralDemoScene(sCtx, 640, 360, intervalStart, sceneId);
      renderProceduralDemoScene(eCtx, 640, 360, intervalEnd, sceneId);
    }

    const trackedEndAnn: ScreenAnnotation = {
      ...computeTrackedKeyframe(
        startCanvas,
        endCanvas,
        { ...baseAnn, createdAtTime: intervalStart },
        intervalEnd
      ),
      startTime: intervalStart,
      endTime: intervalEnd,
    };

    setAnnotations((prev) => [
      ...prev.filter(
        (a) =>
          !(
            isAnnotationInTimeframe(a, intervalStart, intervalEnd) &&
            a.color === targetTrackColor
          )
      ),
      {
        ...baseAnn,
        createdAtTime: intervalStart,
        startTime: intervalStart,
        endTime: intervalEnd,
      },
      trackedEndAnn,
    ]);
    setStatusMessage(
      `AI Auto-Tracked ${targetTrackColor.toUpperCase()} highlight across [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]!`
    );
  };

  const getNormalizedPoint = (
    e: React.PointerEvent<SVGElement>
  ): NormalizedPoint => {
    const svg = overlaySvgRef.current;
    if (!svg) return { x: 0.5, y: 0.5 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (canvasTransformRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e);
    setCurrentStroke([pt]);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (canvasTransformRef.current) {
      const tf = canvasTransformRef.current;
      const pt = getNormalizedPoint(e);
      const dx = pt.x - tf.startPt.x;
      const dy = pt.y - tf.startPt.y;

      let nx = tf.initialBbox.x;
      let ny = tf.initialBbox.y;
      let nw = tf.initialBbox.width;
      let nh = tf.initialBbox.height;

      const minSize = 0.03;

      if (tf.mode === 'move') {
        nx = Math.max(0, Math.min(1 - nw, tf.initialBbox.x + dx));
        ny = Math.max(0, Math.min(1 - nh, tf.initialBbox.y + dy));
      } else {
        if (tf.mode.includes('w')) {
          const right = tf.initialBbox.x + tf.initialBbox.width;
          nx = Math.max(0, Math.min(right - minSize, tf.initialBbox.x + dx));
          nw = right - nx;
        }
        if (tf.mode.includes('e')) {
          nw = Math.max(
            minSize,
            Math.min(1 - tf.initialBbox.x, tf.initialBbox.width + dx)
          );
        }
        if (tf.mode.includes('n')) {
          const bottom = tf.initialBbox.y + tf.initialBbox.height;
          ny = Math.max(0, Math.min(bottom - minSize, tf.initialBbox.y + dy));
          nh = bottom - ny;
        }
        if (tf.mode.includes('s')) {
          nh = Math.max(
            minSize,
            Math.min(1 - tf.initialBbox.y, tf.initialBbox.height + dy)
          );
        }
      }

      const newBbox = {
        x: nx,
        y: ny,
        width: nw,
        height: nh,
        cx: nx + nw / 2,
        cy: ny + nh / 2,
      };

      const scaleX =
        tf.initialBbox.width > 0.001 ? nw / tf.initialBbox.width : 1;
      const scaleY =
        tf.initialBbox.height > 0.001 ? nh / tf.initialBbox.height : 1;

      const newPoints =
        tf.initialPoints.length > 2
          ? tf.initialPoints.map((p) => ({
              x: Math.min(
                1,
                Math.max(0, nx + (p.x - tf.initialBbox.x) * scaleX)
              ),
              y: Math.min(
                1,
                Math.max(0, ny + (p.y - tf.initialBbox.y) * scaleY)
              ),
            }))
          : [
              { x: nx, y: ny },
              { x: nx + nw, y: ny + nh },
            ];

      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === tf.annId ? { ...a, bbox: newBbox, points: newPoints } : a
        )
      );
      setEdits((prev) =>
        prev.map((ed) => ({
          ...ed,
          annotations: ed.annotations.map((a) =>
            a.id === tf.annId || a.color === tf.color
              ? { ...a, bbox: newBbox, points: newPoints }
              : a
          ),
        }))
      );
      return;
    }

    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);
    if (activeTool === 'brush') {
      setCurrentStroke((prev) => (prev ? [...prev, pt] : [pt]));
    } else {
      setCurrentStroke((prev) => (prev ? [prev[0], pt] : [pt]));
    }
  };

  const stretchColorInterval = useCallback(
    (color: MarkColor, newStart: number, newEnd: number) => {
      const clampedStart = Math.max(0, Math.min(newStart, newEnd - 0.3));
      const clampedEnd = Math.min(duration, Math.max(newEnd, clampedStart + 0.3));

      setIntervalStart(clampedStart);
      setIntervalEnd(clampedEnd);

      setAnnotations((prev) =>
        prev.map((a) =>
          a.color === color
            ? { ...a, startTime: clampedStart, endTime: clampedEnd }
            : a
        )
      );

      setEdits((prev) =>
        prev.map((ed) =>
          ed.targetColor === color
            ? {
                ...ed,
                startTime: clampedStart,
                endTime: clampedEnd,
                annotations: ed.annotations.map((a) => ({
                  ...a,
                  startTime: clampedStart,
                  endTime: clampedEnd,
                })),
              }
            : ed
        )
      );
    },
    [duration]
  );

  const selectColorForAi = useCallback(
    (color: MarkColor | 'all') => {
      setFocusedColor(color);
      setIsEditingIntervalBadge(false);
      if (color !== 'all') {
        const matching = annotations.filter((a) => a.color === color);
        if (matching.length > 0) {
          const starts = matching
            .map((m) => m.startTime)
            .filter((v): v is number => typeof v === 'number');
          const ends = matching
            .map((m) => m.endTime)
            .filter((v): v is number => typeof v === 'number');
          if (starts.length > 0 && ends.length > 0) {
            const s = Math.min(...starts);
            const e = Math.max(...ends);
            setIntervalStart(s);
            setIntervalEnd(e);
            setDraftIntervalStart(s.toFixed(1));
            setDraftIntervalEnd(e.toFixed(1));
          }
        }
      }
    },
    [annotations]
  );

  const commitCustomInterval = useCallback(
    (startStr: string, endStr: string, closeEditor = true) => {
      const rawStart = parseFloat(startStr);
      const rawEnd = parseFloat(endStr);
      if (!Number.isNaN(rawStart) && !Number.isNaN(rawEnd)) {
        const low = Math.min(rawStart, rawEnd);
        const high = Math.max(rawStart, rawEnd);
        const clampedStart = Number(
          Math.max(0, Math.min(duration - 0.3, low)).toFixed(2)
        );
        const clampedEnd = Number(
          Math.min(duration, Math.max(clampedStart + 0.3, high)).toFixed(2)
        );

        if (focusedColor !== 'all') {
          stretchColorInterval(focusedColor, clampedStart, clampedEnd);
        } else {
          setIntervalStart(clampedStart);
          setIntervalEnd(clampedEnd);
        }
        if (closeEditor) {
          setDraftIntervalStart(clampedStart.toFixed(1));
          setDraftIntervalEnd(clampedEnd.toFixed(1));
        }
      }
      if (closeEditor) {
        setIsEditingIntervalBadge(false);
      }
    },
    [duration, focusedColor, stretchColorInterval]
  );

  const handleCanvasPointerUp = () => {
    if (canvasTransformRef.current) {
      canvasTransformRef.current = null;
      return;
    }
    if (!currentStroke || currentStroke.length === 0) return;
    const bbox = computeBoundingBox(currentStroke, activeTool);

    // For Box tool, ignore tiny accidental clicks; for Dot tool, a single click places the dot!
    if (
      activeTool !== 'dot' &&
      (currentStroke.length < 2 || (bbox.width < 0.025 && bbox.height < 0.025))
    ) {
      setCurrentStroke(null);
      return;
    }

    // Ensure the new placement's timeframe includes the current playhead timestamp (`currentTime`)
    let targetStart = intervalStart;
    let targetEnd = intervalEnd;
    if (currentTime < intervalStart - 0.05 || currentTime > intervalEnd + 0.05) {
      const span = Math.max(2.5, intervalEnd - intervalStart);
      targetStart = Number(Math.max(0, Math.min(duration - 0.5, currentTime)).toFixed(1));
      targetEnd = Number(Math.min(duration, targetStart + span).toFixed(1));
      setIntervalStart(targetStart);
      setIntervalEnd(targetEnd);
    }

    const drawnColor =
      activeTool === 'arrow' && focusedColor !== 'all' ? focusedColor : activeColor;
    const newAnnotation: ScreenAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      color: drawnColor,
      tool: activeTool,
      points:
        activeTool === 'dot'
          ? [currentStroke[currentStroke.length - 1]]
          : currentStroke,
      strokeWidth: 4,
      bbox,
      createdAtTime: currentTime,
      startTime: targetStart,
      endTime: targetEnd,
    };
    const nextAllAnns = [...annotations, newAnnotation];
    recordHistorySnapshot();
    setAnnotations(nextAllAnns);
    setCurrentStroke(null);

    // Connect the Bottom AI Bar to the color just drawn, while algorithmically picking a maximally distinct next color
    setFocusedColor(drawnColor);
    if (activeTool !== 'arrow') {
      const nextColor = getNextHighlightColor(nextAllAnns, [drawnColor]);
      setActiveColor(nextColor);
    }
  };

  const captureCompositeVisualPrompt = (): string | undefined => {
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas) return undefined;
    const offscreen = document.createElement('canvas');
    offscreen.width = 640;
    offscreen.height = 360;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(displayCanvas, 0, 0, 640, 360);
    for (const ann of timeframeAnnotations) {
      const colorCfg = MARK_COLORS[ann.color];
      const bx = ann.bbox.x * 640;
      const by = ann.bbox.y * 360;
      const bw = ann.bbox.width * 640;
      const bh = ann.bbox.height * 360;

      ctx.save();
      ctx.strokeStyle = colorCfg.hex;
      ctx.fillStyle = colorCfg.fillRgba;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = colorCfg.hex;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(ann.color.toUpperCase(), bx + 4, Math.max(14, by - 4));
      ctx.restore();
    }
    return offscreen.toDataURL('image/png', 0.85);
  };

  const handleApplyAiPrompt = async (
    customPrompt?: string,
    targetSpecificColor?: MarkColor
  ) => {
    const rawText = (customPrompt ?? prompt).trim();
    if (!rawText) return;

    const effectiveTargetColor: MarkColor | 'all' =
      targetSpecificColor ?? focusedColor;

    // Include annotations matching the target color (even if playhead moved outside), plus all placed annotations for full context
    const scopedAnnotations =
      effectiveTargetColor !== 'all'
        ? annotations.filter((a) => a.color === effectiveTargetColor)
        : timeframeAnnotations.length > 0
        ? timeframeAnnotations
        : annotations;

    setIsCompiling(true);
    setStatusMessage(
      effectiveTargetColor !== 'all'
        ? `${MARK_COLORS[effectiveTargetColor].name} AI applying "${rawText}" in [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
        : `Applying AI edit for timeframe [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
    );

    try {
      const compositeFrameDataUrl = captureCompositeVisualPrompt();
      const activeKey =
        aiSettings.apiKeys[aiSettings.provider] ||
        aiSettings.apiKeys.auto ||
        geminiApiKey ||
        '';
      const activeMediaCategory: 'video' | 'image' | 'audio' = activeImageUrl
        ? 'image'
        : activeAudioUrl && !videoUrl
        ? 'audio'
        : 'video';

      const response = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'edit',
          prompt: rawText,
          startTime: intervalStart,
          endTime: intervalEnd,
          currentTime,
          duration,
          focusedColor: effectiveTargetColor,
          annotations: scopedAnnotations,
          allAnnotations: annotations,
          existingEdits: edits.map((e) => ({
            id: e.id,
            summary: e.summary,
            effectType: e.effectType,
            targetColor: e.targetColor,
            startTime: e.startTime,
            endTime: e.endTime,
          })),
          splitPoints,
          cuts: cuts.map((c) => ({ startTime: c.startTime, endTime: c.endTime })),
          mediaFileName: videoFileName,
          mediaCategory: activeMediaCategory,
          compositeFrameDataUrl,
          provider: aiSettings.provider,
          model: aiSettings.model,
          apiKey: activeKey,
          apiKeys: aiSettings.apiKeys,
          geminiApiKey,
          customBaseUrl: aiSettings.customBaseUrl,
          customContextPrompt: aiSettings.customContextPrompt,
        }),
      });

      const data = await response.json();
      const hasEdits = Array.isArray(data.edits) && data.edits.length > 0;
      const hasCuts = Array.isArray(data.cutsToAdd) && data.cutsToAdd.length > 0;
      const hasSplits =
        Array.isArray(data.splitsToAdd) && data.splitsToAdd.length > 0;

      if (hasEdits || hasCuts || hasSplits) {
        recordHistorySnapshot();
        if (hasEdits) {
          setEdits((prev) => [...prev, ...data.edits]);
          setSelectedEditId(data.edits[0].id);
          if (sfxEnabled) {
            playAiEffectSoundCue(data.edits[0].effectType);
          }
        }
        if (hasCuts) {
          setCuts((prev) => [
            ...prev,
            ...data.cutsToAdd.map(
              (c: { startTime: number; endTime: number }, i: number) => ({
                id: `cut-ai-${Date.now()}-${i}`,
                startTime: c.startTime,
                endTime: c.endTime,
              })
            ),
          ]);
        }
        if (hasSplits) {
          setSplitPoints((prev) =>
            Array.from(new Set([...prev, ...data.splitsToAdd])).sort(
              (a, b) => a - b
            )
          );
        }
        setCurrentTime(intervalStart);
        setIsPlaying(true);
        setStatusMessage(
          `Applied ${data.edits?.length || 0} edit(s) via ${data.provider}`
        );
        if (targetSpecificColor) {
          setColorPrompts((prev) => ({ ...prev, [targetSpecificColor]: '' }));
        } else if (!customPrompt) {
          setPrompt('');
        }
      }
    } catch (error) {
      console.error('Failed to apply AI edit:', error);
      setStatusMessage('Error compiling AI prompt. Please try again.');
    } finally {
      setIsCompiling(false);
    }
  };

  const visibleTimelineSpan = Math.max(0.5, duration / timelineZoom);
  const maxTimelineScrollStart = Math.max(0, duration - visibleTimelineSpan);
  const timelineViewStart = Math.min(
    maxTimelineScrollStart,
    Math.max(0, timelineScrollStart)
  );
  const timelineViewEnd = timelineViewStart + visibleTimelineSpan;

  const timeToTimelinePct = useCallback(
    (t: number) => ((t - timelineViewStart) / visibleTimelineSpan) * 100,
    [timelineViewStart, visibleTimelineSpan]
  );

  const spanToTimelinePct = useCallback(
    (span: number) => (span / visibleTimelineSpan) * 100,
    [visibleTimelineSpan]
  );

  const handleTimelineZoomChange = useCallback(
    (nextZoomRaw: number) => {
      const nextZoom = Math.min(16, Math.max(1, Number(nextZoomRaw.toFixed(2))));
      const nextSpan = Math.max(0.5, duration / nextZoom);
      const nextMaxScroll = Math.max(0, duration - nextSpan);
      const centeredScroll = Math.min(
        nextMaxScroll,
        Math.max(0, currentTime - nextSpan / 2)
      );
      setTimelineZoom(nextZoom);
      setTimelineScrollStart(nextZoom === 1 ? 0 : centeredScroll);
    },
    [duration, currentTime]
  );

  useEffect(() => {
    if (!isPlaying || timelineZoom <= 1) return;
    if (
      currentTime > timelineViewEnd - visibleTimelineSpan * 0.05 ||
      currentTime < timelineViewStart
    ) {
      const nextScroll = Math.min(
        maxTimelineScrollStart,
        Math.max(0, currentTime - visibleTimelineSpan * 0.15)
      );
      setTimelineScrollStart(nextScroll);
    }
  }, [
    currentTime,
    isPlaying,
    timelineZoom,
    timelineViewStart,
    timelineViewEnd,
    visibleTimelineSpan,
    maxTimelineScrollStart,
  ]);

  const getTimeFromTimelineEvent = useCallback(
    (clientX: number) => {
      const track = timelineTrackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Number(
        Math.min(
          duration,
          Math.max(0, timelineViewStart + ratio * visibleTimelineSpan)
        ).toFixed(2)
      );
    },
    [duration, timelineViewStart, visibleTimelineSpan]
  );

  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      if (draggingColorEdgeRef.current) {
        const { color, edge, initialStart, initialEnd, grabTime } =
          draggingColorEdgeRef.current;
        const t = getTimeFromTimelineEvent(e.clientX);
        const matching = annotations.filter((a) => a.color === color);
        const curStart =
          matching.length > 0 && matching[0].startTime !== undefined
            ? matching[0].startTime
            : intervalStart;
        const curEnd =
          matching.length > 0 && matching[0].endTime !== undefined
            ? matching[0].endTime
            : intervalEnd;

        if (edge === 'start') {
          const nextStart = Math.min(t, curEnd - 0.3);
          stretchColorInterval(color, nextStart, curEnd);
        } else if (edge === 'end') {
          const nextEnd = Math.max(t, curStart + 0.3);
          stretchColorInterval(color, curStart, nextEnd);
        } else if (
          edge === 'move' &&
          initialStart !== undefined &&
          initialEnd !== undefined &&
          grabTime !== undefined
        ) {
          const span = initialEnd - initialStart;
          const delta = t - grabTime;
          const nextStart = Math.max(
            0,
            Math.min(duration - span, initialStart + delta)
          );
          const nextEnd = nextStart + span;
          stretchColorInterval(color, nextStart, nextEnd);
        }
        return;
      }

      if (!draggingHandleRef.current) return;
      const t = getTimeFromTimelineEvent(e.clientX);
      if (draggingHandleRef.current === 'start') {
        const nextStart = Math.min(t, intervalEnd - 0.3);
        if (focusedColor !== 'all') {
          stretchColorInterval(focusedColor, nextStart, intervalEnd);
        } else {
          setIntervalStart(nextStart);
        }
      } else if (draggingHandleRef.current === 'end') {
        const nextEnd = Math.max(t, intervalStart + 0.3);
        if (focusedColor !== 'all') {
          stretchColorInterval(focusedColor, intervalStart, nextEnd);
        } else {
          setIntervalEnd(nextEnd);
        }
      } else if (draggingHandleRef.current === 'playhead') {
        setCurrentTime(t);
        if (videoRef.current && videoUrl) {
          videoRef.current.currentTime = t;
        }
      }
    };

    const handleWindowPointerUp = () => {
      draggingHandleRef.current = null;
      draggingColorEdgeRef.current = null;
      canvasTransformRef.current = null;
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, [
    annotations,
    duration,
    focusedColor,
    getTimeFromTimelineEvent,
    intervalStart,
    intervalEnd,
    stretchColorInterval,
    videoUrl,
  ]);

  // TRUE HIGH-DEFINITION EXPORT ENGINE (720p, 1080p, 1440p, 4K UHD)
  const startHighDefinitionExport = async () => {
    if (isExporting) return;
    const { width, height, label } = resolveExportDimensions(
      exportConfig.resolution,
      videoMeta
    );
    const { mimeType, extension } = getOptimalVideoMimeType();

    const startT = exportConfig.range === 'interval' ? intervalStart : 0;
    const endT = exportConfig.range === 'interval' ? intervalEnd : duration;
    const totalExportSeconds = Math.max(1, endT - startT);

    setIsExporting(true);
    setExportProgress(0);
    setIsPlaying(false);
    setStatusMessage(
      `Rendering ${label} @ ${exportConfig.fps}fps (${exportConfig.bitrateMbps} Mbps)...`
    );

    const hdSourceCanvas = document.createElement('canvas');
    hdSourceCanvas.width = width;
    hdSourceCanvas.height = height;
    const hdOutCanvas = document.createElement('canvas');
    hdOutCanvas.width = width;
    hdOutCanvas.height = height;

    const srcCtx = hdSourceCanvas.getContext('2d');
    const outCtx = hdOutCanvas.getContext('2d');
    if (!srcCtx || !outCtx) {
      setIsExporting(false);
      return;
    }

    const stream = hdOutCanvas.captureStream(exportConfig.fps);

    // Attach source video audio track if enabled and available
    if (exportConfig.includeAudio && videoRef.current && videoUrl) {
      try {
        const vidWithCapture = videoRef.current as HTMLVideoElement & {
          captureStream?: () => MediaStream;
          mozCaptureStream?: () => MediaStream;
        };
        const vidStream =
          vidWithCapture.captureStream?.() || vidWithCapture.mozCaptureStream?.();
        const audioTracks = vidStream?.getAudioTracks() || [];
        if (audioTracks.length > 0) {
          stream.addTrack(audioTracks[0]);
        }
      } catch {
        // Ignore audio capture errors on cross-origin or muted streams
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: exportConfig.bitrateMbps * 1_000_000,
        audioBitsPerSecond: 192_000,
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `sumo-videoeditor-${exportConfig.resolution}-${width}x${height}-${Date.now()}.${extension}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(dlUrl), 3000);
      setIsExporting(false);
      setExportProgress(100);
      setShowExportModal(false);
      setStatusMessage(
        `Exported ${label} (${width}×${height} @ ${exportConfig.bitrateMbps} Mbps) successfully!`
      );
    };

    if (videoRef.current && videoUrl) {
      videoRef.current.currentTime = startT;
      await videoRef.current.play().catch(() => {});
    }

    recorder.start(250);
    const exportStartWall = performance.now();

    const stepFrame = (now: number) => {
      const elapsedSec = (now - exportStartWall) / 1000;
      const rawTime = Math.min(endT, startT + elapsedSec);
      const simTime = skipCutSegments(rawTime);
      const pct = Math.min(99, Math.round((elapsedSec / totalExportSeconds) * 100));
      setExportProgress(pct);
      setCurrentTime(simTime);

      if (videoUrl) {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          if (Math.abs(videoRef.current.currentTime - simTime) > 0.1) {
            videoRef.current.currentTime = simTime;
          }
          srcCtx.drawImage(videoRef.current, 0, 0, width, height);
        }
      } else if (activeImageUrl && imageRef.current && imageRef.current.complete) {
        srcCtx.fillStyle = '#181614';
        srcCtx.fillRect(0, 0, width, height);
        srcCtx.drawImage(imageRef.current, 0, 0, width, height);
      } else {
        srcCtx.fillStyle = '#181614';
        srcCtx.fillRect(0, 0, width, height);
      }

      renderCompositedFrame(outCtx, hdSourceCanvas, width, height, simTime, edits);

      // Also mirror onto displayCanvas so user watches the live HD render
      const disp = displayCanvasRef.current;
      if (disp) {
        const dCtx = disp.getContext('2d');
        dCtx?.drawImage(hdOutCanvas, 0, 0, disp.width, disp.height);
      }

      if (elapsedSec < totalExportSeconds && recorder.state === 'recording') {
        requestAnimationFrame(stepFrame);
      } else {
        if (videoRef.current && videoUrl) {
          videoRef.current.pause();
        }
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }
    };

    requestAnimationFrame(stepFrame);
  };

  const colorSummaries = summarizeColorGroups(timeframeAnnotations);
  const allColorGroups = summarizeColorGroups(annotations);
  const selectedEdit = edits.find((e) => e.id === selectedEditId) || null;

  const primaryColor = colorSummaries[0]?.color ?? activeColor;
  const secondaryColor =
    colorSummaries[1]?.color ?? (primaryColor === 'red' ? 'blue' : 'red');

  // Collect distinct saved timeframes from both annotations and timeline edits so the user can jump back anytime
  const savedTimeframes = React.useMemo(() => {
    const map = new Map<
      string,
      { startTime: number; endTime: number; colors: MarkColor[] }
    >();
    const addRange = (s: number, e: number, c?: MarkColor) => {
      const key = `${s.toFixed(1)}-${e.toFixed(1)}`;
      const existing = map.get(key) ?? { startTime: s, endTime: e, colors: [] };
      if (c && !existing.colors.includes(c)) {
        existing.colors.push(c);
      }
      map.set(key, existing);
    };

    for (const ann of annotations) {
      if (ann.startTime !== undefined && ann.endTime !== undefined) {
        addRange(ann.startTime, ann.endTime, ann.color);
      }
    }
    for (const ed of edits) {
      const c =
        ed.targetColor && ed.targetColor !== 'all' ? ed.targetColor : undefined;
      addRange(ed.startTime, ed.endTime, c);
    }
    return Array.from(map.values()).sort((a, b) => a.startTime - b.startTime);
  }, [annotations, edits]);

  const handleStartNewTimeframe = () => {
    const nextStart = Number(Math.min(duration - 2, intervalEnd + 0.5).toFixed(1));
    const nextEnd = Number(Math.min(duration, nextStart + 3.5).toFixed(1));
    setIntervalStart(nextStart);
    setIntervalEnd(nextEnd);
    setCurrentTime(nextStart);
  };

  const filteredLibraryItems = mediaLibrary.filter((item) => {
    const matchesScope =
      libraryScope === 'favorites' ? item.isFavorite : item.inCurrentProject;
    return matchesScope && item.category === libraryCategory;
  });

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={handleStageDrop}
      className="flex flex-col h-screen w-screen bg-[#f4f1ea] text-[#26231f] overflow-hidden"
    >
      {/* Drag-and-Drop Fullscreen Import Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-8 pointer-events-none">
          <div className="bg-[#faf8f4] border border-[#d6cfc2] rounded-2xl p-10 text-center space-y-2 shadow-lg">
            <Upload className="w-10 h-10 mx-auto text-[#b82d23]" />
            <h2 className="text-lg font-semibold text-[#26231f]">
              Drop Video, Image, Sound, or Project File
            </h2>
          </div>
        </div>
      )}

      {/* Hidden Offscreen Media Elements (Isolated in 0x0 fixed container so resolution changes never shift layout) */}
      <div className="fixed top-0 left-0 w-0 h-0 overflow-hidden opacity-0 pointer-events-none">
        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            width={1}
            height={1}
            playsInline
            muted={isMuted}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const vidDuration = v.duration || 10;
              const vw = v.videoWidth || 1920;
              const vh = v.videoHeight || 1080;
              const ratio =
                vw > vh ? '16:9 Widescreen' : vh > vw ? '9:16 Vertical' : '1:1 Square';

              setDuration(vidDuration);
              setCurrentTime(0);
              setIntervalStart(0);
              setIntervalEnd(Math.min(5, vidDuration));
              setVideoMeta({
                width: vw,
                height: vh,
                duration: vidDuration,
                aspectRatioLabel: `${vw}×${vh} (${ratio})`,
                hasAudio: true,
                isCustomVideo: true,
              });
            }}
            onLoadedData={(e) => {
              const v = e.currentTarget;
              if (sourceCanvasRef.current) {
                const ctx = sourceCanvasRef.current.getContext('2d');
                if (ctx) {
                  drawMediaContain(
                    ctx,
                    v,
                    sourceCanvasRef.current.width,
                    sourceCanvasRef.current.height,
                    v.videoWidth || 1280,
                    v.videoHeight || 720
                  );
                }
              }
            }}
          />
        )}

        {activeImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imageRef}
            src={activeImageUrl}
            alt=""
            width={1}
            height={1}
          />
        )}

        {activeAudioUrl && (
          <audio
            ref={audioRef}
            src={activeAudioUrl}
            preload="auto"
          />
        )}
      </div>

      {/* MAIN FULL-HEIGHT WORKSPACE (Locked 3-Column Layout) */}
      <div className="flex-1 flex min-h-0 w-full overflow-hidden">
        {/* LEFT SIDEBAR: VIDEOS, IMAGES & SOUND LIBRARY (Locked 16rem width & constant row heights) */}
        <aside className="w-64 min-w-[16rem] max-w-[16rem] border-r border-[#ded7c8] bg-[#faf8f4] flex flex-col shrink-0 h-full overflow-hidden">
          {/* Top Bar (h-11 aligned with Center Toolbar & Right Sidebar Header): Current Project vs Favorites */}
          <div className="h-11 px-2.5 border-b border-[#ded7c8] flex items-center shrink-0">
            <div className="w-full h-7 grid grid-cols-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setLibraryScope('project')}
                className={`w-full h-full flex items-center justify-center rounded-md transition cursor-pointer ${
                  libraryScope === 'project'
                    ? 'bg-[#26231f] text-white'
                    : 'text-[#6e655c] hover:text-[#26231f]'
                }`}
              >
                Current Project
              </button>
              <button
                type="button"
                onClick={() => setLibraryScope('favorites')}
                className={`w-full h-full flex items-center justify-center gap-1 rounded-md transition cursor-pointer ${
                  libraryScope === 'favorites'
                    ? 'bg-[#26231f] text-white'
                    : 'text-[#6e655c] hover:text-[#26231f]'
                }`}
              >
                <Star className="w-3 h-3 text-[#c6923a] fill-[#c6923a] shrink-0" />
                <span>Favorites</span>
              </button>
            </div>
          </div>

          {/* Category Tabs: Videos | Images | Sound (Locked h-11 height & tabular-nums counts) */}
          <div className="h-11 px-2.5 border-b border-[#ded7c8] grid grid-cols-3 gap-1.5 items-center text-xs font-medium shrink-0">
            {(
              [
                { id: 'video', label: 'Videos', icon: Film },
                { id: 'image', label: 'Images', icon: ImageIcon },
                { id: 'audio', label: 'Sound', icon: Music },
              ] as const
            ).map(({ id, label, icon: Icon }) => {
              const count = mediaLibrary.filter(
                (m) =>
                  (libraryScope === 'favorites'
                    ? m.isFavorite
                    : m.inCurrentProject) && m.category === id
              ).length;
              const active = libraryCategory === id;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => setLibraryCategory(id)}
                  className={`w-full h-7 flex items-center justify-center gap-1 px-1 rounded-lg border transition cursor-pointer tabular-nums ${
                    active
                      ? 'bg-[#26231f] border-[#26231f] text-white'
                      : 'bg-[#f4f1ea] border-[#ded7c8] text-[#6e655c] hover:text-[#26231f] hover:bg-[#f0ece1]'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {label}
                    {count > 0 ? ` (${count})` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Full-Height Media Asset List (Stable Scrollbar Gutter & Fixed Item Heights) */}
          <div className="flex-1 flex flex-col p-2.5 gap-2 overflow-hidden min-h-0">
            <label className="w-full h-8 flex items-center justify-center bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] transition cursor-pointer shrink-0">
              <span>
                Add {libraryCategory === 'audio' ? 'Sound' : libraryCategory === 'image' ? 'Image' : 'Video'}
              </span>
              <input
                type="file"
                multiple
                accept={
                  libraryCategory === 'video'
                    ? 'video/*'
                    : libraryCategory === 'image'
                    ? 'image/*'
                    : 'audio/*'
                }
                onChange={handleFileInputChange}
                className="hidden"
              />
            </label>

            <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable] space-y-1.5 min-h-0">
              {filteredLibraryItems.map((asset) => {
                  const isActive =
                    videoUrl === asset.url ||
                    activeImageUrl === asset.url ||
                    activeAudioUrl === asset.url;
                  return (
                    <div
                      key={asset.id}
                      onClick={() => activateMediaAsset(asset)}
                      className={`w-full h-9 group flex items-center justify-between gap-1.5 px-2.5 rounded-xl border transition cursor-pointer ${
                        isActive
                          ? 'bg-[#f0ece1] border-[#26231f]'
                          : 'bg-[#f4f1ea] border-[#ded7c8] hover:bg-[#f0ece1]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {asset.category === 'video' ? (
                          <Film className="w-3.5 h-3.5 text-[#234c7a] shrink-0" />
                        ) : asset.category === 'image' ? (
                          <ImageIcon className="w-3.5 h-3.5 text-[#50793e] shrink-0" />
                        ) : (
                          <Music className="w-3.5 h-3.5 text-[#b82d23] shrink-0" />
                        )}
                        <span className="text-xs font-medium text-[#26231f] truncate">
                          {asset.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavoriteAsset(asset.id);
                          }}
                          title={
                            asset.isFavorite
                              ? 'Remove from Favorites'
                              : 'Save to Favorites (persisted across sessions)'
                          }
                          className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 cursor-pointer"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              asset.isFavorite
                                ? 'text-[#c6923a] fill-[#c6923a]'
                                : 'text-[#8c8277]'
                            }`}
                          />
                        </button>

                        {libraryScope === 'project' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              recordHistorySnapshot();
                              setMediaLibrary((prev) =>
                                prev
                                  .map((m) =>
                                    m.id === asset.id
                                      ? { ...m, inCurrentProject: false }
                                      : m
                                  )
                                  .filter((m) => m.inCurrentProject || m.isFavorite)
                              );
                            }}
                            title="Remove from project"
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#b82d23]/10 text-[#8c8277] hover:text-[#b82d23] cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </aside>

        {/* CENTER: UNIFIED TOP BAR, STAGE, PROMPT BAR, TIMELINE (Locked Flex Column) */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#f4f1ea]">
          {/* UNIFIED TOP BAR: Rigid fixed-width controls & smaller adaptive text so nothing shifts */}
          <div className="h-11 min-h-[2.75rem] max-h-[2.75rem] border-b border-[#ded7c8] bg-[#faf8f4] px-3 flex items-center justify-between gap-2 shrink-0 overflow-hidden">
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
              <div className="h-7 flex items-center bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-0.5 shrink-0">
                {(
                  [
                    { id: 'rect', label: 'Box', icon: Square },
                    { id: 'dot', label: 'Dot', icon: Circle },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTool(id)}
                    className={`w-14 h-6 flex items-center justify-center gap-1 rounded-md text-[11px] font-medium transition cursor-pointer shrink-0 ${
                      activeTool === id
                        ? 'bg-[#26231f] text-white'
                        : 'text-[#6e655c] hover:text-[#26231f]'
                    }`}
                  >
                    <Icon className="w-3 h-3 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </div>

              {/* Cut on Red Playhead Button (Rigid w-24 width) */}
              <button
                onClick={handleCutInterval}
                title={`Cut at red playhead (${currentTime.toFixed(1)}s) [Shortcut: C]`}
                className="w-24 min-w-[6rem] max-w-[6rem] h-7 flex items-center justify-center gap-1 px-2 bg-[#f0ece1] hover:bg-[#b82d23] hover:text-white border border-[#d6cfc2] rounded-lg text-[11px] font-medium tabular-nums text-[#26231f] transition cursor-pointer shrink-0 overflow-hidden"
              >
                <Scissors className="w-3 h-3 shrink-0" />
                <span className="truncate">Cut ({currentTime.toFixed(1)}s)</span>
              </button>

              {/* Delete Selected Segment / Box / Dot Button (Rigid w-28 width; text adapts to fit) */}
              <button
                onClick={handleDeleteSelected}
                title={
                  selectedSegment
                    ? `Delete selected segment (${selectedSegment.startTime.toFixed(1)}s–${selectedSegment.endTime.toFixed(1)}s) [Del / Backspace]`
                    : 'Delete cut segment or selected Box/Dot [Del / Backspace]'
                }
                className={`w-28 min-w-[7rem] max-w-[7rem] h-7 flex items-center justify-center gap-1 px-2 bg-[#f0ece1] hover:bg-[#b82d23] hover:text-white border border-[#d6cfc2] rounded-lg font-medium tabular-nums text-[#26231f] transition cursor-pointer shrink-0 overflow-hidden ${
                  selectedSegment ? 'text-[10px]' : 'text-[11px]'
                }`}
              >
                <Trash2 className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {selectedSegment
                    ? `Del ${selectedSegment.startTime.toFixed(1)}–${selectedSegment.endTime.toFixed(1)}s`
                    : 'Delete'}
                </span>
              </button>

              {/* Undo & Redo Buttons (Rigid w-16 width) */}
              <button
                onClick={handleUndoEdit}
                disabled={undoStack.length === 0}
                title="Undo (Ctrl+Z / Cmd+Z)"
                className="w-16 min-w-[4rem] max-w-[4rem] h-7 flex items-center justify-center gap-1 px-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] disabled:opacity-40 disabled:pointer-events-none border border-[#d6cfc2] rounded-lg text-[11px] font-medium text-[#26231f] cursor-pointer shrink-0"
              >
                <Undo2 className="w-3 h-3 shrink-0" />
                <span className="truncate">Undo</span>
              </button>

              <button
                onClick={handleRedoEdit}
                disabled={redoStack.length === 0}
                title="Redo (Ctrl+X / Cmd+X / Ctrl+Y)"
                className="w-16 min-w-[4rem] max-w-[4rem] h-7 flex items-center justify-center gap-1 px-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] disabled:opacity-40 disabled:pointer-events-none border border-[#d6cfc2] rounded-lg text-[11px] font-medium text-[#26231f] cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3 h-3 scale-x-[-1] shrink-0" />
                <span className="truncate">Redo</span>
              </button>

              <button
                onClick={() => setShowMarkingsOverlay((v) => !v)}
                title="Show / Hide Highlights"
                className="w-7 h-7 flex items-center justify-center bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] cursor-pointer shrink-0"
              >
                {showMarkingsOverlay ? (
                  <Eye className="w-3.5 h-3.5 text-[#50793e]" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-[#837a6d]" />
                )}
              </button>
            </div>

            {/* Right Actions: Save, Settings, Export + ⋯ (Rigid fixed sizes) */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() =>
                  exportProjectFile({
                    sceneId,
                    intervalStart,
                    intervalEnd,
                    annotations,
                    edits,
                  })
                }
                title="Save Project (.chromacut.json)"
                className="w-7 h-7 flex items-center justify-center bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] transition cursor-pointer shrink-0"
              >
                <Save className="w-3.5 h-3.5 text-[#50793e]" />
              </button>

              <button
                onClick={() => setShowSettingsModal(true)}
                title="AI Settings"
                className="w-7 h-7 flex items-center justify-center bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] transition cursor-pointer shrink-0"
              >
                <Settings className="w-3.5 h-3.5 text-[#6e655c]" />
              </button>

              <div className="h-7 flex items-center bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-0.5 shrink-0">
                <button
                  onClick={startHighDefinitionExport}
                  disabled={isExporting}
                  className="w-28 min-w-[7rem] max-w-[7rem] h-6 flex items-center justify-center gap-1 px-2 bg-[#b82d23] hover:bg-[#a1261d] disabled:opacity-50 rounded-md text-[11px] font-medium tabular-nums text-white transition cursor-pointer shrink-0 overflow-hidden"
                  title="Export video"
                >
                  <Download className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {isExporting
                      ? `${exportProgress}%`
                      : `Export ${exportConfig.resolution.toUpperCase()}`}
                  </span>
                </button>

                <button
                  onClick={() => setShowExportModal(true)}
                  className="w-6 h-6 flex items-center justify-center text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer shrink-0"
                  title="Export settings (Resolution, FPS, Bitrate, Frame PNG)"
                >
                  ⋯
                </button>
              </div>
            </div>
          </div>

          {/* VIDEO CANVAS & INTERACTIVE SVG DRAWING OVERLAY (Strict 16:9 Fit Inside Locked Container — Never Stretched & Never Shifts) */}
          <div
            style={{ containerType: 'size' }}
            className="flex-1 relative flex items-center justify-center p-3 min-h-0 overflow-hidden bg-[#ebe6dc]"
          >
            <div
              style={{
                width: 'min(100cqw, calc(100cqh * 16 / 9))',
                height: 'min(100cqh, calc(100cqw * 9 / 16))',
              }}
              className="relative border border-[#d6cfc2] shadow-sm bg-[#181614] overflow-hidden shrink-0"
            >
              <canvas
                ref={displayCanvasRef}
                width={1280}
                height={720}
                className="w-full h-full block"
              />

              {/* Interactive SVG Drawing Layer */}
              <svg
                ref={overlaySvgRef}
                viewBox="0 0 1000 562.5"
                preserveAspectRatio="none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                className="absolute inset-0 w-full h-full cursor-crosshair touch-none overflow-hidden"
              >
                {showMarkingsOverlay &&
                  [...timeframeAnnotations]
                    .sort((a, b) =>
                      a.tool === 'dot' && b.tool !== 'dot'
                        ? 1
                        : a.tool !== 'dot' && b.tool === 'dot'
                        ? -1
                        : 0
                    )
                    .map((ann) => {
                      const cfg = MARK_COLORS[ann.color];
                      const isFocused = focusedColor === ann.color;
                      const bx = ann.bbox.x * 1000;
                      const by = ann.bbox.y * 562.5;
                      const bw = ann.bbox.width * 1000;
                      const bh = ann.bbox.height * 562.5;

                      const removeSingleAnnotation = (
                        e: React.PointerEvent<SVGElement>
                      ) => {
                        e.stopPropagation();
                        const sameColorCount = annotations.filter(
                          (a) => a.color === ann.color
                        ).length;
                        if (sameColorCount > 1) {
                          recordHistorySnapshot();
                          setAnnotations((prev) =>
                            prev.filter((a) => a.id !== ann.id)
                          );
                        } else {
                          deleteColor(ann.color);
                        }
                      };

                      const startTransform = (
                        e: React.PointerEvent<SVGElement>,
                        mode:
                          | 'move'
                          | 'nw'
                          | 'ne'
                          | 'sw'
                          | 'se'
                          | 'n'
                          | 's'
                          | 'w'
                          | 'e'
                      ) => {
                        e.stopPropagation();
                        recordHistorySnapshot();
                        overlaySvgRef.current?.setPointerCapture(e.pointerId);
                        selectColorForAi(ann.color);
                        canvasTransformRef.current = {
                          annId: ann.id,
                          color: ann.color,
                          mode,
                          startPt: getNormalizedPoint(e),
                          initialBbox: { ...ann.bbox },
                          initialPoints: ann.points.map((p) => ({ ...p })),
                        };
                      };

                      if (ann.tool === 'dot') {
                        const dcx = ann.bbox.cx * 1000;
                        const dcy = ann.bbox.cy * 562.5;
                        const dotBadgeW = Math.max(56, Math.round(cfg.name.length * 6.2 + 20));
                        const dotLabelX = Math.max(4, Math.min(975 - dotBadgeW, dcx - dotBadgeW / 2));
                        const dotLabelY = Math.max(4, dcy - 36);
                        return (
                          <g key={ann.id}>
                            <g
                              onPointerDown={(e) => startTransform(e, 'move')}
                              className="cursor-move"
                            >
                              {/* Outer Target Ring */}
                              <circle
                                cx={dcx}
                                cy={dcy}
                                r={16}
                                fill={cfg.fillRgba}
                                stroke={cfg.hex}
                                strokeWidth={isFocused ? 3 : 2}
                              />
                              {/* Crosshair Ticks */}
                              <line
                                x1={dcx - 22}
                                y1={dcy}
                                x2={dcx - 10}
                                y2={dcy}
                                stroke={cfg.hex}
                                strokeWidth={2}
                              />
                              <line
                                x1={dcx + 10}
                                y1={dcy}
                                x2={dcx + 22}
                                y2={dcy}
                                stroke={cfg.hex}
                                strokeWidth={2}
                              />
                              <line
                                x1={dcx}
                                y1={dcy - 22}
                                x2={dcx}
                                y2={dcy - 10}
                                stroke={cfg.hex}
                                strokeWidth={2}
                              />
                              <line
                                x1={dcx}
                                y1={dcy + 10}
                                x2={dcx}
                                y2={dcy + 22}
                                stroke={cfg.hex}
                                strokeWidth={2}
                              />
                              {/* Center Exact Pinpoint Dot */}
                              <circle
                                cx={dcx}
                                cy={dcy}
                                r={6}
                                fill={cfg.hex}
                                stroke="#ffffff"
                                strokeWidth={2}
                              />

                              {/* Dot Color Label Badge */}
                              <rect
                                x={dotLabelX}
                                y={dotLabelY}
                                width={dotBadgeW}
                                height={18}
                                rx={4}
                                fill={cfg.hex}
                              />
                              <text
                                x={dotLabelX + dotBadgeW / 2}
                                y={dotLabelY + 12.5}
                                fill={cfg.textColorHex}
                                fontSize="10"
                                fontWeight="600"
                                textAnchor="middle"
                              >
                                ● {cfg.name}
                              </text>
                            </g>

                            {/* Delete Button (×) for Dot */}
                            <g
                              onPointerDown={removeSingleAnnotation}
                              className="cursor-pointer"
                            >
                              <rect
                                x={dotLabelX + dotBadgeW + 2}
                                y={dotLabelY}
                                width={18}
                                height={18}
                                rx={4}
                                fill="#26231f"
                              />
                              <text
                                x={dotLabelX + dotBadgeW + 11}
                                y={dotLabelY + 13}
                                fill="#ffffff"
                                fontSize="12"
                                fontWeight="bold"
                                textAnchor="middle"
                              >
                                ×
                              </text>
                            </g>
                          </g>
                        );
                      }

                      const handles: Array<{
                        mode: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e';
                        cx: number;
                        cy: number;
                        cursor: string;
                      }> = [
                        { mode: 'nw', cx: bx, cy: by, cursor: 'cursor-nwse-resize' },
                        {
                          mode: 'ne',
                          cx: bx + bw,
                          cy: by,
                          cursor: 'cursor-nesw-resize',
                        },
                        {
                          mode: 'sw',
                          cx: bx,
                          cy: by + bh,
                          cursor: 'cursor-nesw-resize',
                        },
                        {
                          mode: 'se',
                          cx: bx + bw,
                          cy: by + bh,
                          cursor: 'cursor-nwse-resize',
                        },
                        {
                          mode: 'n',
                          cx: bx + bw / 2,
                          cy: by,
                          cursor: 'cursor-ns-resize',
                        },
                        {
                          mode: 's',
                          cx: bx + bw / 2,
                          cy: by + bh,
                          cursor: 'cursor-ns-resize',
                        },
                        {
                          mode: 'w',
                          cx: bx,
                          cy: by + bh / 2,
                          cursor: 'cursor-ew-resize',
                        },
                        {
                          mode: 'e',
                          cx: bx + bw,
                          cy: by + bh / 2,
                          cursor: 'cursor-ew-resize',
                        },
                      ];

                      const labelY = Math.max(4, by - 22);
                      const boxBadgeW = Math.max(52, Math.round(cfg.name.length * 6.2 + 14));

                      return (
                        <g key={ann.id}>
                          {/* Translucent Box Fill is pointer-events-none so you can freely place Dots or smaller Boxes inside it! */}
                          <rect
                            x={bx}
                            y={by}
                            width={bw}
                            height={bh}
                            rx={6}
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={isFocused ? 4 : 3}
                            className="pointer-events-none"
                          />

                          {/* Border Stroke & Label Badge are draggable so you can move the Box by its edge or label */}
                          <g
                            onPointerDown={(e) => startTransform(e, 'move')}
                            className="cursor-move"
                          >
                            <rect
                              x={bx}
                              y={by}
                              width={bw}
                              height={bh}
                              rx={6}
                              fill="none"
                              stroke="transparent"
                              strokeWidth={14}
                              pointerEvents="stroke"
                            />

                            {/* Color Label Badge */}
                            <rect
                              x={bx}
                              y={labelY}
                              width={boxBadgeW}
                              height={18}
                              rx={4}
                              fill={cfg.hex}
                            />
                            <text
                              x={bx + boxBadgeW / 2}
                              y={labelY + 12.5}
                              fill={cfg.textColorHex}
                              fontSize="10"
                              fontWeight="600"
                              textAnchor="middle"
                            >
                              {cfg.name}
                            </text>
                          </g>

                          {/* Delete Button (×) right on the placed highlight badge */}
                          <g
                            onPointerDown={removeSingleAnnotation}
                            className="cursor-pointer"
                          >
                            <rect
                              x={bx + boxBadgeW + 2}
                              y={labelY}
                              width={18}
                              height={18}
                              rx={4}
                              fill="#26231f"
                            />
                            <text
                              x={bx + boxBadgeW + 11}
                              y={labelY + 13}
                              fill="#ffffff"
                              fontSize="12"
                              fontWeight="bold"
                              textAnchor="middle"
                            >
                              ×
                            </text>
                          </g>

                          {/* 8 Stretch / Resize Handles around the placed highlight */}
                          {handles.map((h) => (
                            <rect
                              key={h.mode}
                              x={h.cx - 5.5}
                              y={h.cy - 5.5}
                              width={11}
                              height={11}
                              rx={2.5}
                              fill="#ffffff"
                              stroke={cfg.hex}
                              strokeWidth={2}
                              onPointerDown={(e) => startTransform(e, h.mode)}
                              className={h.cursor}
                            />
                          ))}
                        </g>
                      );
                    })}

                {currentStroke &&
                  currentStroke.length > 0 &&
                  (() => {
                    const cfg = MARK_COLORS[activeColor];
                    if (activeTool === 'dot') {
                      const pt = currentStroke[currentStroke.length - 1];
                      return (
                        <g>
                          <circle
                            cx={pt.x * 1000}
                            cy={pt.y * 562.5}
                            r={16}
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={2.5}
                          />
                          <circle
                            cx={pt.x * 1000}
                            cy={pt.y * 562.5}
                            r={6}
                            fill={cfg.hex}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    }
                    const previewBox = computeBoundingBox(
                      currentStroke,
                      activeTool
                    );
                    const bx = previewBox.x * 1000;
                    const by = previewBox.y * 562.5;
                    const bw = previewBox.width * 1000;
                    const bh = previewBox.height * 562.5;

                    return (
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        rx={6}
                        fill={cfg.fillRgba}
                        stroke={cfg.hex}
                        strokeWidth={3.5}
                      />
                    );
                  })()}
              </svg>

              {/* Split-Screen Wipe Slider Bar */}
              {splitCompareEnabled && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#faf8f4]/95 border border-[#d6cfc2] rounded-lg px-3 py-1 flex items-center gap-2 shadow-sm">
                  <span className="text-[11px] font-medium">Split:</span>
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.01}
                    value={splitCompareX}
                    onChange={(e) => setSplitCompareX(parseFloat(e.target.value))}
                    className="w-32 accent-[#b82d23]"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ADAPTIVE BOTTOM AI BAR (Enlarged & locked height/width base so clicking color never shifts video or bar) */}
          <div className="h-14 min-h-[3.5rem] max-h-[3.5rem] border-t border-[#ded7c8] bg-[#faf8f4] px-4 flex items-center shrink-0 overflow-hidden">
            <div className="w-full flex items-center gap-2.5 min-w-0">
              {isEditingIntervalBadge ? (
                <div
                  style={
                    focusedColor !== 'all'
                      ? {
                          backgroundColor: MARK_COLORS[focusedColor].hex,
                          color: MARK_COLORS[focusedColor].textColorHex,
                        }
                      : undefined
                  }
                  className={`w-64 min-w-[16rem] max-w-[16rem] h-9 flex items-center justify-between gap-1.5 px-2.5 rounded-lg text-xs font-medium shrink-0 border ${
                    focusedColor === 'all'
                      ? 'bg-[#f0ece1] border-[#26231f] text-[#26231f]'
                      : 'border-black/15'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      commitCustomInterval(draftIntervalStart, draftIntervalEnd, true)
                    }
                    className="flex items-center gap-1 cursor-pointer truncate shrink-0"
                    title="Click to finish editing interval"
                  >
                    {focusedColor !== 'all' ? (
                      <>
                        <span
                          className="w-2 h-2 rounded-full border border-white/70 shrink-0"
                          style={{ backgroundColor: MARK_COLORS[focusedColor].hex }}
                        />
                        <span className="truncate">{MARK_COLORS[focusedColor].name}</span>
                      </>
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-[#6e655c] shrink-0" />
                    )}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={duration}
                      autoFocus
                      value={draftIntervalStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftIntervalStart(val);
                        commitCustomInterval(val, draftIntervalEnd, false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitCustomInterval(draftIntervalStart, draftIntervalEnd, true);
                        } else if (e.key === 'Escape') {
                          setIsEditingIntervalBadge(false);
                        }
                      }}
                      className="w-13 px-1.5 py-0.5 rounded bg-white/95 text-[#26231f] font-mono text-xs tabular-nums border border-black/20 focus:outline-none"
                      title="Start time (seconds)"
                    />
                    <span className="opacity-80">–</span>
                    <input
                      type="number"
                      step={0.1}
                      min={0}
                      max={duration}
                      value={draftIntervalEnd}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftIntervalEnd(val);
                        commitCustomInterval(draftIntervalStart, val, false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitCustomInterval(draftIntervalStart, draftIntervalEnd, true);
                        } else if (e.key === 'Escape') {
                          setIsEditingIntervalBadge(false);
                        }
                      }}
                      className="w-13 px-1.5 py-0.5 rounded bg-white/95 text-[#26231f] font-mono text-xs tabular-nums border border-black/20 focus:outline-none"
                      title="End time (seconds)"
                    />
                    <span className="opacity-80 text-[11px]">s</span>
                    <button
                      type="button"
                      onClick={() =>
                        commitCustomInterval(draftIntervalStart, draftIntervalEnd, true)
                      }
                      className="ml-0.5 px-1.5 py-0.5 rounded bg-black/25 hover:bg-black/40 text-white text-[10px] font-semibold cursor-pointer"
                      title="Set timeframe"
                    >
                      ✓
                    </button>
                  </div>
                </div>
              ) : focusedColor !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    recordHistorySnapshot();
                    setDraftIntervalStart(intervalStart.toFixed(1));
                    setDraftIntervalEnd(intervalEnd.toFixed(1));
                    setIsEditingIntervalBadge(true);
                  }}
                  style={{
                    backgroundColor: MARK_COLORS[focusedColor].hex,
                    color: MARK_COLORS[focusedColor].textColorHex,
                  }}
                  title="Click color name to type a specific start & end time"
                  className="w-64 min-w-[16rem] max-w-[16rem] h-9 flex items-center justify-between gap-2 px-3 rounded-lg border border-black/15 text-xs font-medium shrink-0 cursor-pointer hover:opacity-90 transition"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2 h-2 rounded-full border border-white/70 shrink-0"
                      style={{ backgroundColor: MARK_COLORS[focusedColor].hex }}
                    />
                    <span className="truncate">{MARK_COLORS[focusedColor].name}</span>
                  </span>
                  <span className="font-mono tabular-nums opacity-95 shrink-0">
                    {intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    recordHistorySnapshot();
                    setDraftIntervalStart(intervalStart.toFixed(1));
                    setDraftIntervalEnd(intervalEnd.toFixed(1));
                    setIsEditingIntervalBadge(true);
                  }}
                  title="Click to type a specific start & end time"
                  className="w-64 min-w-[16rem] max-w-[16rem] h-9 flex items-center justify-between gap-2 px-3 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-mono font-medium text-[#26231f] shrink-0 cursor-pointer transition"
                >
                  <span className="flex items-center gap-1.5 font-sans">
                    <Clock className="w-3.5 h-3.5 text-[#6e655c]" />
                    <span>Timeframe</span>
                  </span>
                  <span className="tabular-nums">
                    {intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s
                  </span>
                </button>
              )}

              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleApplyAiPrompt(
                      undefined,
                      focusedColor !== 'all' ? focusedColor : undefined
                    );
                  }
                }}
                placeholder={
                  focusedColor !== 'all'
                    ? `Describe edit for ${MARK_COLORS[focusedColor].name}...`
                    : 'Describe edit...'
                }
                className="h-9 flex-1 min-w-0 px-3 bg-[#f4f1ea] border border-[#d6cfc2] rounded-lg focus:outline-none focus:border-[#26231f] text-sm text-[#26231f] placeholder-[#8c8277]"
              />

              <button
                onClick={() =>
                  handleApplyAiPrompt(
                    undefined,
                    focusedColor !== 'all' ? focusedColor : undefined
                  )
                }
                disabled={isCompiling || !prompt.trim()}
                className="w-20 min-w-[5rem] max-w-[5rem] h-9 flex items-center justify-center px-2 bg-[#b82d23] hover:bg-[#a1261d] disabled:opacity-40 rounded-lg text-[11px] font-medium text-white transition cursor-pointer shrink-0 truncate"
              >
                {isCompiling ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>

          {/* SINGLE-FOCUS TIMELINE (Enlarged & locked h-44 base height so video size never shifts) */}
          <div className="h-44 min-h-[11rem] max-h-[11rem] border-t border-[#ded7c8] bg-[#faf8f4] px-4 py-2.5 flex flex-col gap-2 shrink-0 overflow-hidden">
            <div className="h-7 min-h-[1.75rem] max-h-[1.75rem] flex items-center justify-between gap-2 shrink-0 overflow-hidden">
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-7 w-7 bg-[#26231f] hover:bg-[#3d3833] rounded-lg flex items-center justify-center text-white transition cursor-pointer shrink-0"
                  title="Play / Pause (Space)"
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5" />
                  )}
                </button>

                {videoUrl && (
                  <button
                    onClick={() => setIsMuted((m) => !m)}
                    className="h-7 w-7 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg flex items-center justify-center text-[#26231f] cursor-pointer shrink-0"
                  >
                    {isMuted ? (
                      <VolumeX className="w-3.5 h-3.5 text-[#b82d23]" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-[#50793e]" />
                    )}
                  </button>
                )}

                <span className="w-24 min-w-[6rem] max-w-[6rem] text-center font-mono text-[11px] tabular-nums text-[#6e655c] truncate shrink-0">
                  {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>

                <button
                  onClick={() => setLoopIntervalOnly((l) => !l)}
                  className={`w-16 min-w-[4rem] max-w-[4rem] h-6 flex items-center justify-center gap-1 px-1.5 rounded-md text-[11px] font-medium border transition cursor-pointer shrink-0 ${
                    loopIntervalOnly
                      ? 'bg-[#50793e] text-white border-[#50793e]'
                      : 'bg-[#f0ece1] text-[#6e655c] border-[#d6cfc2] hover:text-[#26231f]'
                  }`}
                >
                  <Repeat className="w-3 h-3 shrink-0" />
                  <span className="truncate">Loop</span>
                </button>

                {/* Timeframe Zoom Out / Zoom In Controls right beside Loop */}
                <div className="h-6 flex items-center bg-[#f0ece1] border border-[#d6cfc2] rounded-md p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      handleTimelineZoomChange(
                        timelineZoom <= 1.5
                          ? 1
                          : Math.max(1, Math.round((timelineZoom / 1.5) * 2) / 2)
                      )
                    }
                    disabled={timelineZoom <= 1}
                    title="Zoom out of timeframe"
                    className="h-5 w-5 flex items-center justify-center rounded text-[#26231f] hover:bg-[#e5dfd0] disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition shrink-0"
                  >
                    <ZoomOut className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTimelineZoomChange(1)}
                    title="Reset timeframe zoom to 1x"
                    className="w-9 min-w-[2.25rem] max-w-[2.25rem] text-center text-[10px] font-mono font-medium text-[#26231f] hover:text-[#b82d23] cursor-pointer tabular-nums truncate shrink-0"
                  >
                    {timelineZoom % 1 === 0
                      ? `${timelineZoom}x`
                      : `${timelineZoom.toFixed(1)}x`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleTimelineZoomChange(
                        timelineZoom < 1.5
                          ? 1.5
                          : Math.min(16, Math.round(timelineZoom * 1.5 * 2) / 2)
                      )
                    }
                    disabled={timelineZoom >= 16}
                    title="Zoom in into timeframe"
                    className="h-5 w-5 flex items-center justify-center rounded text-[#26231f] hover:bg-[#e5dfd0] disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition shrink-0"
                  >
                    <ZoomIn className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="w-40 min-w-[10rem] max-w-[10rem] flex items-center justify-end gap-1.5 text-[11px] text-[#6e655c] shrink-0 overflow-hidden">
                {focusedColor !== 'all' ? (
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: MARK_COLORS[focusedColor].hex }}
                    />
                    <span className="truncate">
                      Editing <strong className="text-[#26231f]">{MARK_COLORS[focusedColor].name}</strong>
                    </span>
                  </span>
                ) : (
                  <span className="text-[#8c8277] font-mono tabular-nums truncate">
                    {intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s
                  </span>
                )}
              </div>
            </div>

            {/* Interactive Scrubber & Single Selected Color Stretch Track */}
            <div
              ref={timelineTrackRef}
              onWheel={(e) => {
                if (e.ctrlKey || e.metaKey || e.altKey) {
                  e.preventDefault();
                  const factor = e.deltaY < 0 ? 1.25 : 0.8;
                  handleTimelineZoomChange(timelineZoom * factor);
                } else if (timelineZoom > 1) {
                  const deltaSec =
                    ((e.deltaX !== 0 ? e.deltaX : e.deltaY) / 300) *
                    visibleTimelineSpan;
                  setTimelineScrollStart((prev) =>
                    Math.min(maxTimelineScrollStart, Math.max(0, prev + deltaSec))
                  );
                }
              }}
              onPointerDown={(e) => {
                const t = getTimeFromTimelineEvent(e.clientX);
                setCurrentTime(t);
                if (videoRef.current && videoUrl) {
                  videoRef.current.currentTime = t;
                }
                draggingHandleRef.current = 'playhead';
              }}
              className="relative flex-1 bg-[#f0ece1] border border-[#d6cfc2] rounded-xl overflow-hidden select-none cursor-pointer flex flex-col justify-between p-2"
            >
              {/* Background Audio Waveform Envelope */}
              <div className="pointer-events-none absolute inset-x-2 bottom-1 h-7 flex items-end justify-between gap-[2px] opacity-20">
                {waveformPeaks.map((_, idx) => {
                  const barTime =
                    timelineViewStart +
                    (idx / waveformPeaks.length) * visibleTimelineSpan;
                  const peakIdx = Math.min(
                    waveformPeaks.length - 1,
                    Math.max(
                      0,
                      Math.floor((barTime / Math.max(0.1, duration)) * waveformPeaks.length)
                    )
                  );
                  const peak = waveformPeaks[peakIdx] ?? 0.08;
                  const inActiveInterval =
                    barTime >= intervalStart && barTime <= intervalEnd;
                  return (
                    <div
                      key={idx}
                      style={{ height: `${Math.round(peak * 100)}%` }}
                      className={`flex-1 rounded-t-xs ${
                        inActiveInterval ? 'bg-[#b82d23]' : 'bg-[#26231f]'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Time Ruler Ticks */}
              <div className="relative z-10 flex justify-between text-[10px] font-mono text-[#8c8277] px-1 pointer-events-none">
                {Array.from({ length: 13 }).map((_, i) => {
                  const tickTime = (
                    timelineViewStart +
                    (visibleTimelineSpan / 12) * i
                  ).toFixed(timelineZoom >= 4 ? 2 : 1);
                  return <span key={i}>{tickTime}s</span>;
                })}
              </div>

              {/* Split Segments (Created by Cutting on the Red Playhead — max 2 cuts at a time; click any segment to select & Delete) */}
              {splitPoints.length > 0 &&
                (() => {
                  const sortedSplits = [...splitPoints].sort((a, b) => a - b);
                  const boundaries = [0, ...sortedSplits, duration];
                  return boundaries.slice(0, -1).map((segStart, idx) => {
                    const segEnd = boundaries[idx + 1];
                    const isDeleted = cuts.some(
                      (c) =>
                        Math.abs(c.startTime - segStart) < 0.05 &&
                        Math.abs(c.endTime - segEnd) < 0.05
                    );
                    if (isDeleted) return null;
                    const isSegSelected =
                      selectedSegment !== null &&
                      Math.abs(selectedSegment.startTime - segStart) < 0.05 &&
                      Math.abs(selectedSegment.endTime - segEnd) < 0.05;
                    return (
                      <div
                        key={`seg-${segStart}-${segEnd}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setSelectedSegment({
                            startTime: segStart,
                            endTime: segEnd,
                          });
                        }}
                        style={{
                          left: `${timeToTimelinePct(segStart)}%`,
                          width: `${spanToTimelinePct(segEnd - segStart)}%`,
                        }}
                        title={`Cut segment ${segStart.toFixed(1)}s–${segEnd.toFixed(1)}s (Click to select, then click Delete)`}
                        className={`absolute top-0 bottom-0 z-10 flex items-end justify-between px-1.5 pb-1 transition cursor-pointer ${
                          isSegSelected
                            ? 'bg-[#b82d23]/15 ring-2 ring-inset ring-[#b82d23]'
                            : 'hover:bg-black/5'
                        }`}
                      >
                        <span className="text-[10px] font-mono text-[#6e655c] truncate">
                          {segStart.toFixed(1)}s–{segEnd.toFixed(1)}s
                        </span>
                        {isSegSelected && (
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSelected();
                            }}
                            title="Delete this cut segment"
                            className="px-1.5 py-0.5 rounded bg-[#b82d23] text-white text-[10px] font-medium cursor-pointer"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}

              {/* Split Lines placed by the Red Playhead (max 2; clicking a 3rd cut drops the 1st, or click/right-click ✂ to remove) */}
              {splitPoints.map((pt, cutIdx) => (
                <div
                  key={`split-${pt}`}
                  style={{ left: `${timeToTimelinePct(pt)}%` }}
                  className="absolute top-0 bottom-0 w-0.5 border-l border-dashed border-[#b82d23] z-15 pointer-events-none"
                >
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      recordHistorySnapshot();
                      const remaining = splitPoints.filter((p) => p !== pt);
                      setSplitPoints(remaining);
                      if (remaining.length === 1) {
                        setSelectedSegment({ startTime: 0, endTime: remaining[0] });
                      } else {
                        setSelectedSegment(null);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      recordHistorySnapshot();
                      const remaining = splitPoints.filter((p) => p !== pt);
                      setSplitPoints(remaining);
                      if (remaining.length === 1) {
                        setSelectedSegment({ startTime: 0, endTime: remaining[0] });
                      } else {
                        setSelectedSegment(null);
                      }
                    }}
                    title={`Cut #${cutIdx + 1} at ${pt.toFixed(1)}s (Click or right-click to remove, or place a new Cut to replace #1)`}
                    className="pointer-events-auto absolute bottom-0.5 -left-2.5 w-5 h-4 rounded bg-[#faf8f4]/90 border border-[#b82d23]/40 text-[10px] text-[#b82d23] hover:bg-[#b82d23] hover:text-white font-bold flex items-center justify-center cursor-pointer"
                  >
                    ✂
                  </button>
                </div>
              ))}

              {/* Deleted Segments on Timeline */}
              {cuts.map((cut) => (
                <div
                  key={cut.id}
                  style={{
                    left: `${timeToTimelinePct(cut.startTime)}%`,
                    width: `${spanToTimelinePct(cut.endTime - cut.startTime)}%`,
                  }}
                  className="absolute top-0 bottom-0 bg-[#b82d23]/25 border-x border-[#b82d23] z-10 flex items-end justify-between px-1.5 pb-1"
                  title={`Deleted: ${cut.startTime.toFixed(1)}s–${cut.endTime.toFixed(1)}s`}
                >
                  <span className="text-[10px] font-medium text-[#b82d23] truncate">
                    Deleted
                  </span>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      recordHistorySnapshot();
                      setCuts((prev) => prev.filter((c) => c.id !== cut.id));
                    }}
                    title="Restore deleted segment"
                    className="text-xs font-bold text-[#b82d23] hover:text-[#26231f] cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}

              {/* Active Interval Highlight Zone [intervalStart, intervalEnd] */}
              <div
                style={{
                  left: `${timeToTimelinePct(intervalStart)}%`,
                  width: `${spanToTimelinePct(intervalEnd - intervalStart)}%`,
                }}
                className="absolute top-0 bottom-0 bg-[#c6923a]/15 border-x border-[#c6923a] pointer-events-none"
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    recordHistorySnapshot();
                    draggingHandleRef.current = 'start';
                  }}
                  className="pointer-events-auto absolute -left-2 top-1 w-4 h-5 bg-[#26231f] hover:bg-[#b82d23] rounded-xs flex items-center justify-center cursor-ew-resize"
                  title="Drag interval start"
                >
                  <span className="text-[9px] text-white">[</span>
                </div>

                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    recordHistorySnapshot();
                    draggingHandleRef.current = 'end';
                  }}
                  className="pointer-events-auto absolute -right-2 top-1 w-4 h-5 bg-[#26231f] hover:bg-[#b82d23] rounded-xs flex items-center justify-center cursor-ew-resize"
                  title="Drag interval end"
                >
                  <span className="text-[9px] text-white">]</span>
                </div>
              </div>

              {/* ONLY THE CURRENTLY SELECTED COLOR BAR ON THE TIMELINE (Constant h-7 height) */}
              <div className="relative h-7 w-full flex items-center z-10">
                {(() => {
                  const selectedGroup =
                    focusedColor !== 'all'
                      ? allColorGroups.find((cg) => cg.color === focusedColor)
                      : allColorGroups[0];

                  if (!selectedGroup) {
                    return <div className="w-full h-7 pointer-events-none" />;
                  }

                  const cfg = MARK_COLORS[selectedGroup.color];
                  const leftPct = timeToTimelinePct(selectedGroup.startTime);
                  const rawWidthPct = spanToTimelinePct(
                    selectedGroup.endTime - selectedGroup.startTime
                  );
                  const widthPct = Math.max(4, rawWidthPct);
                  const colorEdits = edits.filter(
                    (e) => e.targetColor === selectedGroup.color
                  );

                  return (
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        recordHistorySnapshot();
                        selectColorForAi(selectedGroup.color);
                        draggingColorEdgeRef.current = {
                          color: selectedGroup.color,
                          edge: 'move',
                          initialStart: selectedGroup.startTime,
                          initialEnd: selectedGroup.endTime,
                          grabTime: getTimeFromTimelineEvent(e.clientX),
                        };
                      }}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: cfg.hex,
                        color: cfg.textColorHex,
                      }}
                      className="absolute top-0 h-7 pl-4 pr-8 flex items-center justify-between text-xs font-medium rounded-md ring-2 ring-[#26231f] transition cursor-grab active:cursor-grabbing select-none"
                    >
                      {/* Left Stretch Handle */}
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          recordHistorySnapshot();
                          selectColorForAi(selectedGroup.color);
                          draggingColorEdgeRef.current = {
                            color: selectedGroup.color,
                            edge: 'start',
                          };
                        }}
                        title="Drag to stretch start time"
                        className="absolute left-0 top-0 bottom-0 w-3.5 bg-black/25 hover:bg-black/50 rounded-l-md flex items-center justify-center cursor-ew-resize"
                      >
                        <span className="text-[9px] text-white">[</span>
                      </div>

                      <div className="flex items-center gap-1.5 min-w-0 truncate px-1">
                        <span className="text-[10px] truncate">
                          {cfg.name} ({selectedGroup.startTime.toFixed(1)}s–{selectedGroup.endTime.toFixed(1)}s)
                          {colorEdits.length > 0
                            ? ` • ${colorEdits.map((e) => e.prompt).join(', ')}`
                            : ''}
                        </span>
                      </div>

                      {/* Delete Button (×) on Selected Timeline Bar */}
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteColor(selectedGroup.color);
                        }}
                        title={`Delete ${cfg.name}`}
                        className="absolute right-3.5 top-0 bottom-0 w-4 hover:bg-black/30 flex items-center justify-center text-white/90 hover:text-white cursor-pointer"
                      >
                        ×
                      </button>

                      {/* Right Stretch Handle */}
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          recordHistorySnapshot();
                          selectColorForAi(selectedGroup.color);
                          draggingColorEdgeRef.current = {
                            color: selectedGroup.color,
                            edge: 'end',
                          };
                        }}
                        title="Drag to stretch end time"
                        className="absolute right-0 top-0 bottom-0 w-3.5 bg-black/25 hover:bg-black/50 rounded-r-md flex items-center justify-center cursor-ew-resize"
                      >
                        <span className="text-[9px] text-white">]</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Current Time Red Playhead Line with On-Playhead Cut Button */}
              <div
                style={{ left: `${timeToTimelinePct(currentTime)}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#b82d23] pointer-events-none z-20"
              >
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCutInterval();
                  }}
                  title={`Cut at ${currentTime.toFixed(1)}s (Shortcut: C)`}
                  className="pointer-events-auto -ml-2.5 top-0.5 w-5 h-5 rounded-full bg-[#b82d23] hover:bg-[#26231f] text-white flex items-center justify-center shadow-xs cursor-pointer transition"
                >
                  <Scissors className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {/* Horizontal Slider Underneath the Timeframe */}
            <div className="h-5 flex items-center gap-2 px-1 shrink-0">
              <span className="text-[10px] font-mono text-[#8c8277] tabular-nums w-9 shrink-0">
                {timelineZoom > 1
                  ? `${timelineViewStart.toFixed(1)}s`
                  : `${currentTime.toFixed(1)}s`}
              </span>
              <input
                type="range"
                min={0}
                max={
                  timelineZoom > 1
                    ? Number(maxTimelineScrollStart.toFixed(2))
                    : Number(duration.toFixed(2))
                }
                step={0.05}
                value={
                  timelineZoom > 1
                    ? Number(timelineViewStart.toFixed(2))
                    : Number(currentTime.toFixed(2))
                }
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (timelineZoom > 1) {
                    setTimelineScrollStart(val);
                  } else {
                    setCurrentTime(val);
                    if (videoRef.current && videoUrl) {
                      videoRef.current.currentTime = val;
                    }
                  }
                }}
                title={
                  timelineZoom > 1
                    ? `Slide to pan zoomed timeframe (${timelineViewStart.toFixed(1)}s–${timelineViewEnd.toFixed(1)}s)`
                    : 'Slide across timeframe'
                }
                className="flex-1 h-1.5 bg-[#e5dfd0] rounded-lg appearance-none cursor-pointer accent-[#26231f]"
              />
              <span className="text-[10px] font-mono text-[#8c8277] tabular-nums w-9 text-right shrink-0">
                {timelineZoom > 1
                  ? `${timelineViewEnd.toFixed(1)}s`
                  : `${duration.toFixed(1)}s`}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR: SCROLLABLE COLORS & EDITS HUB (Constant w-80 width & rigid card layout) */}
        <aside className="w-80 min-w-[20rem] max-w-[20rem] h-full border-l border-[#ded7c8] bg-[#faf8f4] flex flex-col shrink-0 overflow-hidden">
          {/* Header showcasing Placed Color Count */}
          <div className="h-11 min-h-[2.75rem] max-h-[2.75rem] px-3.5 border-b border-[#ded7c8] flex items-center justify-between shrink-0 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-3.5 h-3.5 text-[#6e655c] shrink-0" />
              <h2 className="text-[11px] font-semibold tabular-nums text-[#26231f] truncate">
                Colors ({allColorGroups.length}) & Edits ({edits.length})
              </h2>
            </div>
          </div>

          {/* Scrollable List of Placed Colors & Their Connected Edits */}
          <div className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] p-3 gap-2 min-h-0">
            {allColorGroups.map((cg) => {
                  const cfg = MARK_COLORS[cg.color];
                  const isFocused = focusedColor === cg.color;
                  const colorAnns = annotations.filter(
                    (a) => a.color === cg.color
                  );
                  const hasDot = colorAnns.some((a) => a.tool === 'dot');
                  const hasBox = colorAnns.some((a) => a.tool !== 'dot');
                  const shapeLabel =
                    hasDot && hasBox ? 'Box+Dot' : hasDot ? 'Dot' : 'Box';
                  const colorEdits = edits.filter(
                    (e) => e.targetColor === cg.color
                  );

                  return (
                    <div
                      key={cg.color}
                      onClick={() => selectColorForAi(cg.color)}
                      className={`w-full p-2.5 rounded-xl border transition cursor-pointer space-y-2 shrink-0 overflow-hidden ${
                        isFocused
                          ? 'bg-[#f0ece1] border-[#26231f]'
                          : 'bg-[#f4f1ea] border-[#ded7c8] hover:bg-[#f0ece1]'
                      }`}
                    >
                      <div className="h-6 flex items-center justify-between gap-1.5 overflow-hidden">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: cfg.hex }}
                          />
                          <span className="text-[11px] font-semibold text-[#26231f] truncate">
                            {cfg.name}
                          </span>
                          <span className="w-12 min-w-[3rem] max-w-[3rem] text-center py-0.5 rounded bg-[#faf8f4] border border-[#d6cfc2] text-[9px] font-medium text-[#6e655c] truncate shrink-0">
                            {shapeLabel}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-mono tabular-nums text-[#6e655c]">
                            {cg.startTime.toFixed(1)}s–{cg.endTime.toFixed(1)}s
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteColor(cg.color);
                            }}
                            title={`Delete ${cfg.name}`}
                            className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#b82d23]/10 text-[#6e655c] hover:text-[#b82d23] cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Edits attached to this color */}
                      {colorEdits.length > 0 && (
                        <div className="space-y-1.5 pt-1.5 border-t border-[#ded7c8]">
                          {colorEdits.map((edit) => (
                            <div
                              key={edit.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                selectColorForAi(cg.color);
                                setSelectedEditId(edit.id);
                              }}
                              className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-xs ${
                                selectedEditId === edit.id
                                  ? 'bg-[#faf8f4] border border-[#26231f]'
                                  : 'bg-[#faf8f4]/70 border border-[#ded7c8]'
                              }`}
                            >
                              <span
                                className={`truncate font-medium text-[#26231f] ${
                                  !edit.enabled ? 'line-through opacity-50' : ''
                                }`}
                              >
                                {edit.summary}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    pushEditsWithUndo((prev) =>
                                      prev.map((item) =>
                                        item.id === edit.id
                                          ? { ...item, enabled: !item.enabled }
                                          : item
                                      )
                                    );
                                  }}
                                  className="p-0.5 rounded hover:bg-black/5 text-[#26231f] cursor-pointer"
                                >
                                  {edit.enabled ? (
                                    <Eye className="w-3 h-3 text-[#50793e]" />
                                  ) : (
                                    <EyeOff className="w-3 h-3 text-[#8c8277]" />
                                  )}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    pushEditsWithUndo((prev) =>
                                      prev.filter((item) => item.id !== edit.id)
                                    );
                                  }}
                                  className="p-0.5 rounded hover:bg-[#b82d23]/10 text-[#b82d23] cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Any general edits not bound to a specific placed color */}
                {edits
                  .filter(
                    (e) =>
                      !e.targetColor ||
                      e.targetColor === 'all' ||
                      !allColorGroups.some((cg) => cg.color === e.targetColor)
                  )
                  .map((edit) => {
                    const isSelected = edit.id === selectedEditId;
                    return (
                      <div
                        key={edit.id}
                        onClick={() => {
                          setSelectedEditId(edit.id);
                          setFocusedColor('all');
                          setIntervalStart(edit.startTime);
                          setIntervalEnd(edit.endTime);
                        }}
                        className={`p-2.5 rounded-xl border transition cursor-pointer ${
                          isSelected
                            ? 'bg-[#f0ece1] border-[#26231f]'
                            : 'bg-[#f4f1ea] border-[#ded7c8] hover:bg-[#f0ece1]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[#26231f] truncate">
                            {edit.summary}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                pushEditsWithUndo((prev) =>
                                  prev.map((item) =>
                                    item.id === edit.id
                                      ? { ...item, enabled: !item.enabled }
                                      : item
                                  )
                                );
                              }}
                              className="p-1 rounded hover:bg-black/5 text-[#26231f] cursor-pointer"
                            >
                              {edit.enabled ? (
                                <Eye className="w-3.5 h-3.5 text-[#50793e]" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5 text-[#8c8277]" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                pushEditsWithUndo((prev) =>
                                  prev.filter((item) => item.id !== edit.id)
                                );
                              }}
                              className="p-1 rounded hover:bg-[#b82d23]/10 text-[#b82d23] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] font-mono text-[#6e655c]">
                          <span>
                            {edit.startTime.toFixed(1)}s – {edit.endTime.toFixed(1)}s
                          </span>
                          <span className="uppercase">
                            {edit.effectType.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
          </div>

          {/* Fine-Tune Selected Edit Inspector */}
          {selectedEdit && (
            <div className="p-3.5 border-t border-[#ded7c8] bg-[#f4f1ea] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#26231f] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#b82d23]" />
                  {selectedEdit.summary}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-[#6e655c] block">
                    Start ({selectedEdit.startTime.toFixed(1)}s)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={selectedEdit.startTime}
                    onPointerDown={() => recordHistorySnapshot()}
                    onChange={(e) => {
                      const val = Math.min(
                        parseFloat(e.target.value),
                        selectedEdit.endTime - 0.2
                      );
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? { ...it, startTime: val }
                            : it
                        )
                      );
                    }}
                    className="w-full accent-[#b82d23]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#6e655c] block">
                    End ({selectedEdit.endTime.toFixed(1)}s)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={duration}
                    step={0.1}
                    value={selectedEdit.endTime}
                    onPointerDown={() => recordHistorySnapshot()}
                    onChange={(e) => {
                      const val = Math.max(
                        parseFloat(e.target.value),
                        selectedEdit.startTime + 0.2
                      );
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? { ...it, endTime: val }
                            : it
                        )
                      );
                    }}
                    className="w-full accent-[#b82d23]"
                  />
                </div>
              </div>

              {selectedEdit.effectType === 'zoom' && (
                <div>
                  <label className="text-[10px] text-[#6e655c] block">
                    Zoom Scale ({(selectedEdit.params.zoomScale ?? 1.8).toFixed(1)}x)
                  </label>
                  <input
                    type="range"
                    min={1.1}
                    max={3.5}
                    step={0.1}
                    value={selectedEdit.params.zoomScale ?? 1.8}
                    onPointerDown={() => recordHistorySnapshot()}
                    onChange={(e) => {
                      const zoomScale = parseFloat(e.target.value);
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? {
                                ...it,
                                params: { ...it.params, zoomScale },
                              }
                            : it
                        )
                      );
                    }}
                    className="w-full accent-[#b82d23]"
                  />
                </div>
              )}

              {(selectedEdit.effectType === 'blur' ||
                selectedEdit.effectType === 'pixelate' ||
                selectedEdit.effectType === 'color_grade' ||
                selectedEdit.effectType === 'halftone_ink') && (
                <div className="space-y-2">
                  {selectedEdit.effectType === 'blur' && (
                    <div>
                      <label className="text-[10px] text-[#6e655c] block">
                        Blur ({selectedEdit.params.blurRadius ?? 16}px)
                      </label>
                      <input
                        type="range"
                        min={4}
                        max={36}
                        step={1}
                        value={selectedEdit.params.blurRadius ?? 16}
                        onPointerDown={() => recordHistorySnapshot()}
                        onChange={(e) => {
                          const blurRadius = parseInt(e.target.value, 10);
                          setEdits((prev) =>
                            prev.map((it) =>
                              it.id === selectedEdit.id
                                ? {
                                    ...it,
                                    params: { ...it.params, blurRadius },
                                  }
                                : it
                            )
                          );
                        }}
                        className="w-full accent-[#b82d23]"
                      />
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-xs text-[#26231f] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedEdit.params.invertMask)}
                      onChange={(e) => {
                        recordHistorySnapshot();
                        const invertMask = e.target.checked;
                        setEdits((prev) =>
                          prev.map((it) =>
                            it.id === selectedEdit.id
                              ? {
                                  ...it,
                                  params: { ...it.params, invertMask },
                                }
                              : it
                          )
                        );
                      }}
                    />
                    <span>Invert Mask</span>
                  </label>
                </div>
              )}

              {selectedEdit.effectType === 'text_overlay' && (
                <div>
                  <label className="text-[10px] text-[#6e655c] block mb-1">
                    Text
                  </label>
                  <input
                    type="text"
                    value={selectedEdit.params.text ?? ''}
                    onFocus={() => recordHistorySnapshot()}
                    onChange={(e) => {
                      const text = e.target.value;
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? {
                                ...it,
                                summary: `Callout "${text}"`,
                                params: { ...it.params, text },
                              }
                            : it
                        )
                      );
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-[#d6cfc2] rounded-lg text-xs text-[#26231f]"
                  />
                </div>
              )}

              {selectedEdit.effectType === 'generative_replace' && (
                <div>
                  <label className="text-[10px] text-[#6e655c] block mb-1">
                    Style
                  </label>
                  <select
                    value={selectedEdit.params.generativeStyle ?? 'gold_aura'}
                    onChange={(e) => {
                      recordHistorySnapshot();
                      const generativeStyle = e.target.value as
                        | 'fire'
                        | 'hologram'
                        | 'watercolor'
                        | 'cyber'
                        | 'gold_aura';
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? {
                                ...it,
                                summary: `AI V2V (${generativeStyle.toUpperCase()})`,
                                params: { ...it.params, generativeStyle },
                              }
                            : it
                        )
                      );
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-[#d6cfc2] rounded-lg text-xs text-[#26231f]"
                  >
                    <option value="fire">Fire &amp; Ember</option>
                    <option value="hologram">Hologram</option>
                    <option value="watercolor">Watercolor</option>
                    <option value="cyber">Cyber Pulse</option>
                    <option value="gold_aura">Golden Aura</option>
                  </select>
                </div>
              )}

              {selectedEdit.effectType === 'speed' && (
                <div>
                  <label className="text-[10px] text-[#6e655c] block">
                    Speed ({(selectedEdit.params.playbackRate ?? 1.0).toFixed(2)}x)
                  </label>
                  <input
                    type="range"
                    min={0.25}
                    max={3.0}
                    step={0.25}
                    value={selectedEdit.params.playbackRate ?? 1.0}
                    onChange={(e) => {
                      const playbackRate = parseFloat(e.target.value);
                      setEdits((prev) =>
                        prev.map((it) =>
                          it.id === selectedEdit.id
                            ? {
                                ...it,
                                summary: `Speed ${playbackRate}x`,
                                params: { ...it.params, playbackRate },
                              }
                            : it
                        )
                      );
                    }}
                    className="w-full accent-[#b82d23]"
                  />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* EXPORT MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#faf8f4] border border-[#ded7c8] rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#ded7c8] pb-3">
              <h3 className="text-sm font-semibold text-[#26231f] flex items-center gap-2">
                <Download className="w-4 h-4 text-[#b82d23]" />
                Export Video
              </h3>
              <button
                onClick={() => !isExporting && setShowExportModal(false)}
                className="text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Resolution Quick Selector Cards */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6e655c] block">
                Resolution
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(
                  [
                    { id: '720p', title: '720p', sub: '1280×720' },
                    { id: '1080p', title: '1080p', sub: '1920×1080' },
                    { id: '1440p', title: '1440p', sub: '2560×1440' },
                    { id: '4k', title: '4K UHD', sub: '3840×2160' },
                    {
                      id: 'native',
                      title: 'Native',
                      sub: `${videoMeta.width}×${videoMeta.height}`,
                    },
                  ] as const
                ).map((item) => {
                  const active = exportConfig.resolution === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        const recBitrate =
                          item.id === 'native'
                            ? 24
                            : EXPORT_RESOLUTION_MAP[item.id].recommendedBitrate;
                        setExportConfig((prev) => ({
                          ...prev,
                          resolution: item.id,
                          bitrateMbps: recBitrate,
                        }));
                      }}
                      className={`p-2 rounded-xl border text-center transition cursor-pointer ${
                        active
                          ? 'bg-[#26231f] text-white border-[#26231f]'
                          : 'bg-[#f0ece1] text-[#26231f] border-[#d6cfc2] hover:bg-[#e5dfd0]'
                      }`}
                    >
                      <div className="text-xs font-semibold">{item.title}</div>
                      <div className="text-[10px] opacity-75">{item.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="font-medium text-[#6e655c] block mb-1">
                  Frame Rate
                </label>
                <select
                  value={exportConfig.fps}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      fps: Number(e.target.value) as 24 | 30 | 60,
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg"
                >
                  <option value={24}>24 FPS</option>
                  <option value={30}>30 FPS</option>
                  <option value={60}>60 FPS</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-[#6e655c] block mb-1">
                  Bitrate
                </label>
                <select
                  value={exportConfig.bitrateMbps}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      bitrateMbps: Number(e.target.value) as 12 | 24 | 35 | 50,
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg"
                >
                  <option value={12}>12 Mbps</option>
                  <option value={24}>24 Mbps</option>
                  <option value={35}>35 Mbps</option>
                  <option value={50}>50 Mbps</option>
                </select>
              </div>

              <div>
                <label className="font-medium text-[#6e655c] block mb-1">
                  Range
                </label>
                <select
                  value={exportConfig.range}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      range: e.target.value as 'full' | 'interval',
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg"
                >
                  <option value="full">Full Video</option>
                  <option value="interval">
                    Interval ({intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s)
                  </option>
                </select>
              </div>
            </div>

            {isExporting && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span>Rendering...</span>
                  <span>{exportProgress}%</span>
                </div>
                <div className="w-full h-2.5 bg-[#e5dfd0] rounded-full overflow-hidden">
                  <div
                    style={{ width: `${exportProgress}%` }}
                    className="h-full bg-[#50793e] transition-all"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#ded7c8]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    exportHighDefinitionSnapshotPng({
                      preset: exportConfig.resolution,
                      videoMeta,
                      videoElement: videoRef.current,
                      videoUrl,
                      sceneId,
                      currentTime,
                      edits,
                    })
                  }
                  disabled={isExporting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5 text-[#234c7a]" />
                  <span>Frame PNG</span>
                </button>

                <button
                  onClick={() =>
                    exportBinaryMaskPng({
                      preset: exportConfig.resolution,
                      videoMeta,
                      annotations,
                    })
                  }
                  disabled={isExporting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#50793e]" />
                  <span>Mask PNG</span>
                </button>
              </div>

              <button
                onClick={startHighDefinitionExport}
                disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2 bg-[#b82d23] hover:bg-[#a1261d] disabled:opacity-50 rounded-lg text-xs font-medium text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isExporting
                    ? `Rendering (${exportProgress}%)...`
                    : `Export ${exportConfig.resolution.toUpperCase()}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI SETTINGS MODAL (Simple Single Auto-Detect API Key Input) */}
      {showSettingsModal &&
        (() => {
          const currentAutoKey =
            aiSettings.apiKeys.auto ??
            aiSettings.apiKeys[aiSettings.provider] ??
            geminiApiKey ??
            '';

          return (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-[#faf8f4] border border-[#ded7c8] rounded-2xl p-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#26231f] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#b82d23]" />
                    API Key
                  </h3>
                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#6e655c] block">
                    Paste any API Key (Auto-detects DeepSeek, OpenAI, Gemini, Claude, OpenRouter, Groq, or xAI)
                  </label>
                  <input
                    type="password"
                    value={currentAutoKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAiTestStatus({ loading: false });
                      setGeminiApiKey(val);
                      updateAiSettings((prev) => ({
                        ...prev,
                        provider: 'auto',
                        model: 'auto',
                        apiKeys: {
                          ...prev.apiKeys,
                          auto: val,
                        },
                      }));
                    }}
                    placeholder="sk-... / AIza... / sk-ant-... / sk-or-..."
                    className="w-full px-3 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg text-xs font-mono text-[#26231f]"
                  />
                  {aiTestStatus.message && (
                    <div
                      className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
                        aiTestStatus.ok
                          ? 'bg-[#50793e]/10 border-[#50793e]/30 text-[#50793e]'
                          : 'bg-[#b82d23]/10 border-[#b82d23]/30 text-[#b82d23]'
                      }`}
                    >
                      {aiTestStatus.message}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleTestAiConnection}
                    disabled={aiTestStatus.loading || !currentAutoKey.trim()}
                    className="px-3 py-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] disabled:opacity-40 border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] cursor-pointer transition"
                  >
                    {aiTestStatus.loading ? 'Testing...' : 'Test Key'}
                  </button>

                  <button
                    onClick={() => setShowSettingsModal(false)}
                    className="px-4 py-1.5 bg-[#26231f] hover:bg-[#3d3833] rounded-lg text-xs font-medium text-white cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
