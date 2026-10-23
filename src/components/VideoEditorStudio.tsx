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
} from 'lucide-react';
import {
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
  // Video playback & source state
  const [sceneId, setSceneId] = useState<BuiltInSceneId>('scenic_valley');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('Scenic Valley (1080p HD)');
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [currentTime, setCurrentTime] = useState<number>(1.5);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopIntervalOnly, setLoopIntervalOnly] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  const [videoMeta, setVideoMeta] = useState<VideoMetadataInfo>({
    width: 1920,
    height: 1080,
    duration: DEFAULT_DURATION,
    aspectRatioLabel: '16:9 HD',
    hasAudio: false,
    isCustomVideo: false,
  });

  // Interval selection [startTime, endTime]
  const [intervalStart, setIntervalStart] = useState<number>(1.0);
  const [intervalEnd, setIntervalEnd] = useState<number>(6.5);

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

  // AI Prompt, Per-Color AI Prompts, Timeline Edits, & Smart Interval Suggestions
  const [prompt, setPrompt] = useState<string>('');
  const [colorPrompts, setColorPrompts] = useState<Partial<Record<MarkColor, string>>>({});
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [edits, setEdits] = useState<TimelineEditItem[]>([]);
  const [undoStack, setUndoStack] = useState<TimelineEditItem[][]>([]);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [suggestedIntervals, setSuggestedIntervals] = useState<SuggestedInterval[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(
    'Select an interval [ ], mark screen regions with Red, Blue, Green, or Yellow, and tell AI what to edit!'
  );

  // Modals: Cloud Settings, HD Export Studio, & AI Prompt Grimoire
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showGrimoireModal, setShowGrimoireModal] = useState<boolean>(false);
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(true);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(() =>
    generateProceduralWaveform('scenic_valley', 96)
  );
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [falApiKey, setFalApiKey] = useState<string>('');

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

  const pushEditsWithUndo = useCallback(
    (updater: (prev: TimelineEditItem[]) => TimelineEditItem[]) => {
      setEdits((prev) => {
        setUndoStack((stack) => [...stack.slice(-15), prev]);
        return updater(prev);
      });
    },
    []
  );

  const deleteColor = useCallback(
    (color: MarkColor) => {
      setAnnotations((prev) => prev.filter((a) => a.color !== color));
      pushEditsWithUndo((prev) => prev.filter((e) => e.targetColor !== color));
      if (focusedColor === color) {
        setFocusedColor('all');
      }
    },
    [focusedColor, pushEditsWithUndo]
  );

  const handleUndoEdit = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setEdits(previous);
      return stack.slice(0, -1);
    });
  }, []);

  // Keyboard shortcuts (Space, [, ], 1-4, Delete/Backspace, Ctrl+Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (focusedColor !== 'all') {
          e.preventDefault();
          deleteColor(focusedColor);
        }
      } else if (e.key === '[') {
        setIntervalStart(Math.min(currentTime, intervalEnd - 0.3));
      } else if (e.key === ']') {
        setIntervalEnd(Math.max(currentTime, intervalStart + 0.3));
      } else if (e.key === '1') {
        setActiveColor('red');
      } else if (e.key === '2') {
        setActiveColor('blue');
      } else if (e.key === '3') {
        setActiveColor('green');
      } else if (e.key === '4') {
        setActiveColor('yellow');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndoEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTime, intervalStart, intervalEnd, focusedColor, deleteColor, handleUndoEdit]);

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
          let next = vid.currentTime;
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
            let next = prev + dt * effectiveRate;

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
          const { freeze, freezeTime } = getActivePlaybackRate(currentTime);
          const renderTime = freeze ? freezeTime : currentTime;

          if (videoUrl) {
            // Imported video ALWAYS takes priority — never fall back to the procedural demo scene!
            if (videoRef.current && videoRef.current.readyState >= 2) {
              srcCtx.drawImage(videoRef.current, 0, 0, width, height);
            }
          } else {
            renderProceduralDemoScene(srcCtx, width, height, renderTime, sceneId);
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
    sceneId,
    edits,
    splitCompareEnabled,
    splitCompareX,
    getActivePlaybackRate,
  ]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;
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
      // When paused, keep the video element seeked to currentTime so scrubbing or clicking updates the frame immediately
      if (Math.abs(vid.currentTime - currentTime) > 0.04 && !vid.seeking) {
        vid.currentTime = currentTime;
      }
    }
  }, [isPlaying, videoUrl, currentTime, isMuted, getActivePlaybackRate]);

  // Universal File Import Handler (Video Files OR .chromacut.json Project Files)
  const processImportedFile = (file: File) => {
    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as ProjectFileSchema;
          if (parsed.edits && Array.isArray(parsed.edits)) {
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

    // Clear the source canvas immediately so the procedural scene never shows through
    if (sourceCanvasRef.current) {
      const ctx = sourceCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(
          0,
          0,
          sourceCanvasRef.current.width,
          sourceCanvasRef.current.height
        );
      }
    }

    // Clear any annotations/edits from the old demo scene
    setAnnotations([]);
    setEdits([]);
    setSelectedEditId(null);
    setFocusedColor('all');
    setActiveColor('red');

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
    setIsMuted(false);
    setIsPlaying(true);
    setCurrentTime(0);
    extractAudioPeaksFromFile(file, 96).then((peaks) => setWaveformPeaks(peaks));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImportedFile(file);
      e.target.value = '';
    }
  };

  const handleStageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processImportedFile(file);
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

  // Highlights that belong to the currently selected [intervalStart, intervalEnd] timeframe
  const timeframeAnnotations = annotations.filter((a) =>
    isAnnotationInTimeframe(a, intervalStart, intervalEnd)
  );

  // Automatically pick the next unused color whenever the user switches to a different timeframe
  useEffect(() => {
    const inFrame = annotations.filter((a) =>
      isAnnotationInTimeframe(a, intervalStart, intervalEnd)
    );
    setActiveColor(getNextHighlightColor(inFrame));
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
          }
        }
      }
    },
    [annotations]
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
      startTime: intervalStart,
      endTime: intervalEnd,
    };
    const nextAllAnns = [...annotations, newAnnotation];
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

    // If writing to a specific color's AI, scope annotations to that color and ensure color context
    const scopedAnnotations = targetSpecificColor
      ? timeframeAnnotations.filter((a) => a.color === targetSpecificColor)
      : timeframeAnnotations;

    const textToCompile =
      targetSpecificColor &&
      !new RegExp(`\\b${targetSpecificColor}\\b`, 'i').test(rawText)
        ? `${rawText} on the ${targetSpecificColor} area`
        : rawText;

    setIsCompiling(true);
    setStatusMessage(
      targetSpecificColor
        ? `${MARK_COLORS[targetSpecificColor].name} AI applying "${rawText}" in [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
        : `Applying AI edit for timeframe [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
    );

    try {
      const compositeFrameDataUrl = captureCompositeVisualPrompt();
      const response = await fetch('/api/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToCompile,
          startTime: intervalStart,
          endTime: intervalEnd,
          annotations: scopedAnnotations,
          compositeFrameDataUrl,
          geminiApiKey,
        }),
      });

      const data = await response.json();
      if (data.edits && Array.isArray(data.edits) && data.edits.length > 0) {
        pushEditsWithUndo((prev) => [...prev, ...data.edits]);
        setSelectedEditId(data.edits[0].id);
        setCurrentTime(intervalStart);
        setIsPlaying(true);
        if (sfxEnabled) {
          playAiEffectSoundCue(data.edits[0].effectType);
        }
        setStatusMessage(
          `Applied ${data.edits.length} edit(s) in [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s] via ${data.provider}`
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

  const getTimeFromTimelineEvent = useCallback(
    (clientX: number) => {
      const track = timelineTrackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Number((ratio * duration).toFixed(2));
    },
    [duration]
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
          stretchColorInterval(color, Math.min(t, curEnd - 0.3), curEnd);
          setCurrentTime(t);
        } else if (edge === 'end') {
          stretchColorInterval(color, curStart, Math.max(t, curStart + 0.3));
          setCurrentTime(t);
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
        setCurrentTime(t);
      } else if (draggingHandleRef.current === 'end') {
        const nextEnd = Math.max(t, intervalStart + 0.3);
        if (focusedColor !== 'all') {
          stretchColorInterval(focusedColor, intervalStart, nextEnd);
        } else {
          setIntervalEnd(nextEnd);
        }
        setCurrentTime(t);
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
      a.download = `chromacut-${exportConfig.resolution}-${width}x${height}-${Date.now()}.${extension}`;
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
      const simTime = Math.min(endT, startT + elapsedSec);
      const pct = Math.min(99, Math.round((elapsedSec / totalExportSeconds) * 100));
      setExportProgress(pct);
      setCurrentTime(simTime);

      if (videoUrl) {
        if (videoRef.current && videoRef.current.readyState >= 2) {
          srcCtx.drawImage(videoRef.current, 0, 0, width, height);
        }
      } else {
        renderProceduralDemoScene(srcCtx, width, height, simTime, sceneId);
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

  const handleCycleHighlightColor = () => {
    const idx = COLOR_PROGRESSION.indexOf(activeColor);
    const next = COLOR_PROGRESSION[(idx + 1) % COLOR_PROGRESSION.length];
    setActiveColor(next);
  };

  const handleStartNewTimeframe = () => {
    const nextStart = Number(Math.min(duration - 2, intervalEnd + 0.5).toFixed(1));
    const nextEnd = Number(Math.min(duration, nextStart + 3.5).toFixed(1));
    setIntervalStart(nextStart);
    setIntervalEnd(nextEnd);
    setCurrentTime(nextStart);
    setStatusMessage(
      `Started new timeframe [${nextStart.toFixed(1)}s – ${nextEnd.toFixed(1)}s]. Draw on screen to highlight!`
    );
  };

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
              Drop video or project file
            </h2>
          </div>
        </div>
      )}

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          preload="auto"
          className="fixed -left-[9999px] top-0 w-px h-px opacity-0 pointer-events-none"
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
              ctx?.drawImage(
                v,
                0,
                0,
                sourceCanvasRef.current.width,
                sourceCanvasRef.current.height
              );
            }
          }}
        />
      )}

      {/* TOP HEADER BAR */}
      <header className="h-13 border-b border-[#ded7c8] bg-[#faf8f4] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-lg bg-[#b82d23] flex items-center justify-center text-white">
            <Wand2 className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-sm text-[#26231f]">
            ChromaCut
          </span>

          <select
            value={videoUrl ? 'custom' : sceneId}
            onChange={(e) => {
              const val = e.target.value;
              if (val !== 'custom') {
                setVideoUrl(null);
                setSceneId(val as BuiltInSceneId);
                setWaveformPeaks(
                  generateProceduralWaveform(val as BuiltInSceneId, 96)
                );
                const labels: Record<BuiltInSceneId, string> = {
                  scenic_valley: 'Scenic Valley',
                  night_express: 'Night Express',
                  street_market: 'Festival Market',
                };
                setVideoFileName(labels[val as BuiltInSceneId]);
                setVideoMeta({
                  width: 1920,
                  height: 1080,
                  duration: DEFAULT_DURATION,
                  aspectRatioLabel: '1920×1080',
                  hasAudio: false,
                  isCustomVideo: false,
                });
              }
            }}
            className="px-2.5 py-1 bg-[#f0ece1] hover:bg-[#e7e1d3] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] cursor-pointer focus:outline-none"
          >
            <option value="scenic_valley">Scenic Valley</option>
            <option value="night_express">Night Express</option>
            <option value="street_market">Festival Market</option>
            {videoUrl && <option value="custom">{videoFileName}</option>}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadShowcasePreset}
            className="px-2.5 py-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] transition cursor-pointer"
          >
            Demo
          </button>

          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] transition cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-[#234c7a]" />
            <span>Import</span>
            <input
              type="file"
              accept="video/*,.json"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </label>

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
            className="p-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-[#50793e]" />
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            title="AI Settings"
            className="p-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#6e655c]" />
          </button>

          {/* Direct Resolution Selector + Export Button */}
          <div className="flex items-center bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-0.5">
            <select
              value={exportConfig.resolution}
              onChange={(e) => {
                const res = e.target.value as ExportResolutionPreset;
                const recBitrate =
                  res === 'native'
                    ? 24
                    : EXPORT_RESOLUTION_MAP[res].recommendedBitrate;
                setExportConfig((prev) => ({
                  ...prev,
                  resolution: res,
                  bitrateMbps: recBitrate,
                }));
              }}
              aria-label="Export Resolution"
              className="px-2 py-1 bg-transparent text-xs font-medium text-[#26231f] cursor-pointer focus:outline-none"
            >
              <option value="720p">720p HD</option>
              <option value="1080p">1080p FHD</option>
              <option value="1440p">1440p 2K</option>
              <option value="4k">2160p 4K</option>
              <option value="native">
                Native ({videoMeta.width}×{videoMeta.height})
              </option>
            </select>

            <button
              onClick={startHighDefinitionExport}
              disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1 bg-[#b82d23] hover:bg-[#a1261d] disabled:opacity-50 rounded-md text-xs font-medium text-white transition cursor-pointer"
              title="Export video at selected resolution"
            >
              <Download className="w-3.5 h-3.5" />
              <span>
                {isExporting
                  ? `${exportProgress}%`
                  : `Export ${exportConfig.resolution.toUpperCase()}`}
              </span>
            </button>

            <button
              onClick={() => setShowExportModal(true)}
              className="px-2 py-1 text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer"
              title="More export options (FPS, Bitrate, Frame PNG)"
            >
              ⋯
            </button>
          </div>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT / CENTER: STAGE, HIGHLIGHT BAR, PROMPT BAR, TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#f4f1ea]">
          {/* CLEAN TOOL & VIEW BAR (Colors are picked automatically via Max-Min perceptual distance) */}
          <div className="h-11 border-b border-[#ded7c8] bg-[#faf8f4] px-4 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-0.5">
                {(
                  [
                    { id: 'rect', label: 'Box', icon: Square },
                    { id: 'dot', label: 'Dot', icon: Circle },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTool(id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                      activeTool === id
                        ? 'bg-[#26231f] text-white'
                        : 'text-[#6e655c] hover:text-[#26231f]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: View Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {timeframeAnnotations.length > 0 && (
                <button
                  onClick={handleAutoTrackActiveColor}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] transition cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-[#c6923a]" />
                  <span>Track</span>
                </button>
              )}

              <button
                onClick={() => setSplitCompareEnabled((v) => !v)}
                className={`flex items-center gap-1 px-2.5 py-1 border rounded-lg text-xs font-medium transition cursor-pointer ${
                  splitCompareEnabled
                    ? 'bg-[#234c7a] text-white border-[#234c7a]'
                    : 'bg-[#f0ece1] text-[#26231f] border-[#d6cfc2] hover:bg-[#e5dfd0]'
                }`}
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                <span>Compare</span>
              </button>

              <button
                onClick={() => setShowMarkingsOverlay((v) => !v)}
                title="Show / Hide Highlights"
                className="p-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-[#26231f] cursor-pointer"
              >
                {showMarkingsOverlay ? (
                  <Eye className="w-3.5 h-3.5 text-[#50793e]" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-[#837a6d]" />
                )}
              </button>
            </div>
          </div>

          {/* VIDEO CANVAS & INTERACTIVE SVG DRAWING OVERLAY */}
          <div className="flex-1 relative flex flex-col items-center justify-center p-4 min-h-0 overflow-hidden bg-[#ebe6dc]">
            <div className="relative aspect-video max-h-full max-w-full rounded-xl border border-[#d6cfc2] shadow-sm bg-[#181614] overflow-hidden">
              <canvas
                ref={displayCanvasRef}
                className="w-full h-full block object-contain"
              />

              {/* Interactive SVG Drawing Layer */}
              <svg
                ref={overlaySvgRef}
                viewBox="0 0 1000 562.5"
                preserveAspectRatio="none"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
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

          {/* ADAPTIVE BOTTOM AI BAR (Shows only the currently selected color from the right panel) */}
          <div className="border-t border-[#ded7c8] bg-[#faf8f4] px-4 py-2 shrink-0">
            <div className="max-w-5xl mx-auto flex items-center gap-2">
              {focusedColor !== 'all' ? (
                <div
                  style={{
                    backgroundColor: MARK_COLORS[focusedColor].hex,
                    color: MARK_COLORS[focusedColor].textColorHex,
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium shrink-0"
                >
                  <span
                    className="w-2 h-2 rounded-full border border-white/70"
                    style={{ backgroundColor: MARK_COLORS[focusedColor].hex }}
                  />
                  <span>
                    {MARK_COLORS[focusedColor].name} • {intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg text-xs font-mono font-medium text-[#26231f] shrink-0">
                  <Clock className="w-3.5 h-3.5 text-[#6e655c]" />
                  <span>
                    {intervalStart.toFixed(1)}s–{intervalEnd.toFixed(1)}s
                  </span>
                </div>
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
                className="flex-1 px-3 py-1.5 bg-[#f4f1ea] border border-[#d6cfc2] rounded-lg focus:outline-none focus:border-[#26231f] text-sm text-[#26231f] placeholder-[#8c8277]"
              />

              <button
                onClick={() => setShowGrimoireModal(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg text-xs font-medium text-[#26231f] transition cursor-pointer shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#234c7a]" />
                <span>Presets</span>
              </button>

              <button
                onClick={() =>
                  handleApplyAiPrompt(
                    undefined,
                    focusedColor !== 'all' ? focusedColor : undefined
                  )
                }
                disabled={isCompiling || !prompt.trim()}
                className="px-4 py-1.5 bg-[#b82d23] hover:bg-[#a1261d] disabled:opacity-40 rounded-lg text-xs font-medium text-white transition cursor-pointer shrink-0"
              >
                {isCompiling
                  ? 'Applying...'
                  : focusedColor !== 'all'
                  ? `Apply to ${MARK_COLORS[focusedColor].name}`
                  : 'Apply'}
              </button>
            </div>
          </div>

          {/* SINGLE-FOCUS TIMELINE (Shows ONLY the currently selected color so you can stretch & edit it) */}
          <div className="h-32 border-t border-[#ded7c8] bg-[#faf8f4] px-4 py-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-7 w-7 bg-[#26231f] hover:bg-[#3d3833] rounded-lg flex items-center justify-center text-white transition cursor-pointer"
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
                    className="h-7 w-7 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-lg flex items-center justify-center text-[#26231f] cursor-pointer"
                  >
                    {isMuted ? (
                      <VolumeX className="w-3.5 h-3.5 text-[#b82d23]" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-[#50793e]" />
                    )}
                  </button>
                )}

                <span className="font-mono text-xs text-[#6e655c] px-2 py-0.5">
                  {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>

                <button
                  onClick={() => setLoopIntervalOnly((l) => !l)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border transition cursor-pointer ${
                    loopIntervalOnly
                      ? 'bg-[#50793e] text-white border-[#50793e]'
                      : 'bg-[#f0ece1] text-[#6e655c] border-[#d6cfc2] hover:text-[#26231f]'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Loop</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {focusedColor !== 'all' && (
                  <span className="text-xs text-[#6e655c] flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: MARK_COLORS[focusedColor].hex }}
                    />
                    <span>
                      Editing <strong className="text-[#26231f]">{MARK_COLORS[focusedColor].name}</strong> on timeline
                    </span>
                  </span>
                )}
                <button
                  onClick={handleStartNewTimeframe}
                  className="px-2.5 py-0.5 bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-md text-xs font-medium text-[#26231f] cursor-pointer shrink-0"
                >
                  + Interval
                </button>
              </div>
            </div>

            {/* Interactive Scrubber & Single Selected Color Stretch Track */}
            <div
              ref={timelineTrackRef}
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
                {waveformPeaks.map((peak, idx) => {
                  const barTime = (idx / waveformPeaks.length) * duration;
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
                  const tickTime = ((duration / 12) * i).toFixed(1);
                  return <span key={i}>{tickTime}s</span>;
                })}
              </div>

              {/* Active Interval Highlight Zone [intervalStart, intervalEnd] */}
              <div
                style={{
                  left: `${(intervalStart / duration) * 100}%`,
                  width: `${((intervalEnd - intervalStart) / duration) * 100}%`,
                }}
                className="absolute top-0 bottom-0 bg-[#c6923a]/15 border-x border-[#c6923a] pointer-events-none"
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
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
                    draggingHandleRef.current = 'end';
                  }}
                  className="pointer-events-auto absolute -right-2 top-1 w-4 h-5 bg-[#26231f] hover:bg-[#b82d23] rounded-xs flex items-center justify-center cursor-ew-resize"
                  title="Drag interval end"
                >
                  <span className="text-[9px] text-white">]</span>
                </div>
              </div>

              {/* ONLY THE CURRENTLY SELECTED COLOR BAR ON THE TIMELINE */}
              <div className="relative flex-1 flex items-center z-10">
                {(() => {
                  const selectedGroup =
                    focusedColor !== 'all'
                      ? allColorGroups.find((cg) => cg.color === focusedColor)
                      : allColorGroups[0];

                  if (!selectedGroup) {
                    return (
                      <div className="w-full text-center text-[11px] text-[#8c8277] pointer-events-none">
                        Place a Box or Dot on the video or select a color on the right to edit its timeframe
                      </div>
                    );
                  }

                  const cfg = MARK_COLORS[selectedGroup.color];
                  const leftPct = (selectedGroup.startTime / duration) * 100;
                  const widthPct = Math.max(
                    6,
                    ((selectedGroup.endTime - selectedGroup.startTime) / duration) * 100
                  );
                  const colorEdits = edits.filter(
                    (e) => e.targetColor === selectedGroup.color
                  );

                  return (
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
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
                        marginLeft: `${leftPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: cfg.hex,
                        color: cfg.textColorHex,
                      }}
                      className="relative h-7 pl-4 pr-8 flex items-center justify-between text-xs font-medium rounded-md ring-2 ring-[#26231f] transition cursor-grab active:cursor-grabbing select-none"
                    >
                      {/* Left Stretch Handle */}
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
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

                      <div className="flex items-center gap-1.5 truncate px-1.5">
                        <span className="truncate">
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

              {/* Current Time Playhead Line */}
              <div
                style={{ left: `${(currentTime / duration) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#b82d23] pointer-events-none z-20"
              >
                <div className="w-2.5 h-2.5 -ml-[4px] rounded-full bg-[#b82d23]" />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR: SCROLLABLE COLORS & EDITS HUB */}
        <aside className="w-80 border-l border-[#ded7c8] bg-[#faf8f4] flex flex-col shrink-0">
          {/* Header showcasing Placed Color Count & Variety */}
          <div className="px-3.5 py-2.5 border-b border-[#ded7c8] space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-[#6e655c]" />
                <h2 className="text-xs font-semibold text-[#26231f]">
                  Colors ({allColorGroups.length}) & Edits ({edits.length})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {undoStack.length > 0 && (
                  <button
                    onClick={handleUndoEdit}
                    className="text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer"
                  >
                    Undo
                  </button>
                )}
                {(allColorGroups.length > 0 || edits.length > 0) && (
                  <button
                    onClick={() => {
                      setAnnotations([]);
                      pushEditsWithUndo(() => []);
                      setSelectedEditId(null);
                      setFocusedColor('all');
                    }}
                    className="text-xs text-[#6e655c] hover:text-[#b82d23] cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            {/* Placed Color Variety Mosaic (only displays placed colors — drawing colors are picked automatically) */}
            {allColorGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg p-1.5 max-h-16 overflow-y-auto">
                {allColorGroups.map((cg) => {
                  const cfg = MARK_COLORS[cg.color];
                  const isSelected = focusedColor === cg.color;
                  return (
                    <button
                      key={cg.color}
                      onClick={() => selectColorForAi(cg.color)}
                      title={`${cfg.name} (${cg.startTime.toFixed(1)}s–${cg.endTime.toFixed(1)}s)`}
                      style={{ backgroundColor: cfg.hex }}
                      className={`w-4 h-4 rounded-full transition cursor-pointer ${
                        isSelected
                          ? 'ring-2 ring-[#26231f] scale-110'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Scrollable List of Placed Colors & Their Connected Edits */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {allColorGroups.length === 0 && edits.length === 0 ? (
              <div className="py-10 px-3 text-center text-xs text-[#8c8277] space-y-1">
                <p className="font-medium text-[#6e655c]">No colors placed yet</p>
                <p>
                  Place a Box or Dot on the video scene. All placed colors and their edits will appear here.
                </p>
              </div>
            ) : (
              <>
                {allColorGroups.map((cg) => {
                  const cfg = MARK_COLORS[cg.color];
                  const isFocused = focusedColor === cg.color;
                  const colorAnns = annotations.filter(
                    (a) => a.color === cg.color
                  );
                  const hasDot = colorAnns.some((a) => a.tool === 'dot');
                  const hasBox = colorAnns.some((a) => a.tool !== 'dot');
                  const shapeLabel =
                    hasDot && hasBox ? 'Box + Dot' : hasDot ? 'Dot' : 'Box';
                  const colorEdits = edits.filter(
                    (e) => e.targetColor === cg.color
                  );

                  return (
                    <div
                      key={cg.color}
                      onClick={() => selectColorForAi(cg.color)}
                      className={`p-2.5 rounded-xl border transition cursor-pointer space-y-2 ${
                        isFocused
                          ? 'bg-[#f0ece1] border-[#26231f] ring-1 ring-[#26231f]'
                          : 'bg-[#f4f1ea] border-[#ded7c8] hover:bg-[#f0ece1]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: cfg.hex }}
                          />
                          <span className="text-xs font-semibold text-[#26231f]">
                            {cfg.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-[#faf8f4] border border-[#d6cfc2] text-[10px] font-medium text-[#6e655c]">
                            {shapeLabel}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] font-mono text-[#6e655c]">
                            {cg.startTime.toFixed(1)}s–{cg.endTime.toFixed(1)}s
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteColor(cg.color);
                            }}
                            title={`Delete ${cfg.name}`}
                            className="p-1 rounded hover:bg-[#b82d23]/10 text-[#6e655c] hover:text-[#b82d23] cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Edits attached to this color */}
                      {colorEdits.length > 0 ? (
                        <div className="space-y-1.5 pt-1 border-t border-[#ded7c8]">
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
                      ) : (
                        <div className="text-[11px] text-[#8c8277]">
                          {isFocused
                            ? 'Selected — stretch on timeline below or type an edit'
                            : 'Click to select & edit on timeline'}
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
                          setCurrentTime(edit.startTime);
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
              </>
            )}
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

      {/* AI SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#faf8f4] border border-[#ded7c8] rounded-2xl p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#26231f] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#b82d23]" />
                AI Settings
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
                Google AI Studio Key (Gemini 2.5 Flash — Optional)
              </label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg text-xs text-[#26231f]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6e655c] block">
                fal.ai / Replicate Key (Optional)
              </label>
              <input
                type="password"
                value={falApiKey}
                onChange={(e) => setFalApiKey(e.target.value)}
                placeholder="fal_..."
                className="w-full px-3 py-2 bg-[#f0ece1] border border-[#d6cfc2] rounded-lg text-xs text-[#26231f]"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-[#26231f] hover:bg-[#3d3833] rounded-lg text-xs font-medium text-white cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PRESETS MODAL */}
      {showGrimoireModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#faf8f4] border border-[#ded7c8] rounded-2xl p-6 space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#ded7c8] pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#234c7a]" />
                <h3 className="text-sm font-semibold text-[#26231f]">
                  AI Edit Presets
                </h3>
              </div>
              <button
                onClick={() => setShowGrimoireModal(false)}
                className="text-xs text-[#6e655c] hover:text-[#26231f] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {[
                {
                  title: 'Anime Impact',
                  promptText: `Anime impact on the ${primaryColor} area`,
                },
                {
                  title: 'Bokeh Portrait Blur',
                  promptText: `Blur outside the ${primaryColor} area for bokeh depth-of-field`,
                },
                {
                  title: 'Selective Color Splash',
                  promptText: `Keep the ${primaryColor} area in color and make the background black and white`,
                },
                {
                  title: 'Fire Synthesis (V2V)',
                  promptText: `Replace the ${primaryColor} area with fire synthesis`,
                },
                {
                  title: 'Dual Color Combo',
                  promptText: `Manga halftone ink on the ${primaryColor} area and blur the ${secondaryColor} area`,
                },
                {
                  title: 'Chromatic Glitch + Zoom',
                  promptText: `Chromatic aberration on the ${primaryColor} area and zoom 2x into the ${primaryColor} area`,
                },
              ].map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setPrompt(item.promptText);
                    setShowGrimoireModal(false);
                    handleApplyAiPrompt(item.promptText);
                  }}
                  className="bg-[#f0ece1] hover:bg-[#e5dfd0] border border-[#d6cfc2] rounded-xl p-3 text-left transition cursor-pointer space-y-1"
                >
                  <div className="text-xs font-semibold text-[#26231f]">
                    {item.title}
                  </div>
                  <div className="text-[11px] text-[#6e655c] truncate">
                    {item.promptText}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
