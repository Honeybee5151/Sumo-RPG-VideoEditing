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
  const [activeTool, setActiveTool] = useState<DrawingTool>('rect');
  const [annotations, setAnnotations] = useState<ScreenAnnotation[]>([]);
  const [currentStroke, setCurrentStroke] = useState<NormalizedPoint[] | null>(null);
  const [showMarkingsOverlay, setShowMarkingsOverlay] = useState<boolean>(true);

  // Before / After Comparison Split Wipe
  const [splitCompareEnabled, setSplitCompareEnabled] = useState<boolean>(false);
  const [splitCompareX, setSplitCompareX] = useState<number>(0.5);

  // AI Prompt, Timeline Edits, & Smart Interval Suggestions
  const [prompt, setPrompt] = useState<string>('');
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

  const handleUndoEdit = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const previous = stack[stack.length - 1];
      setEdits(previous);
      return stack.slice(0, -1);
    });
  }, []);

  // Keyboard shortcuts (Space, [, ], 1-4, Ctrl+Z)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
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
  }, [currentTime, intervalStart, intervalEnd, handleUndoEdit]);

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
        setCurrentTime((prev) => {
          const { rate, freeze } = getActivePlaybackRate(prev);
          const effectiveRate = freeze ? 1.0 : rate;
          let next = prev + dt * effectiveRate;

          if (loopIntervalOnly) {
            if (next > intervalEnd || next < intervalStart) {
              next = intervalStart;
              if (videoRef.current && videoUrl) {
                videoRef.current.currentTime = intervalStart;
              }
            }
          } else if (next >= duration) {
            next = 0;
            if (videoRef.current && videoUrl) {
              videoRef.current.currentTime = 0;
            }
          }
          return next;
        });
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

          if (videoUrl && videoRef.current && videoRef.current.readyState >= 2) {
            srcCtx.drawImage(videoRef.current, 0, 0, width, height);
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

    if (isPlaying && vid.paused) {
      vid.play().catch(() => {});
    } else if (!isPlaying && !vid.paused) {
      vid.pause();
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
            setStatusMessage(`Imported project file "${file.name}" (${parsed.edits.length} edits).`);
          }
        } catch {
          setStatusMessage('Invalid project JSON file.');
        }
      };
      reader.readAsText(file);
      return;
    }

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
    setIsPlaying(false);
    setCurrentTime(0);
    extractAudioPeaksFromFile(file, 96).then((peaks) => setWaveformPeaks(peaks));
    setStatusMessage(`Imported HD video "${file.name}". Select an interval and mark areas on screen!`);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImportedFile(file);
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
    e: React.PointerEvent<SVGSVGElement>
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
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getNormalizedPoint(e);
    setCurrentStroke([pt]);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!currentStroke) return;
    const pt = getNormalizedPoint(e);
    if (activeTool === 'brush') {
      setCurrentStroke((prev) => (prev ? [...prev, pt] : [pt]));
    } else {
      setCurrentStroke((prev) => (prev ? [prev[0], pt] : [pt]));
    }
  };

  const handleCanvasPointerUp = () => {
    if (!currentStroke || currentStroke.length === 0) return;
    const bbox = computeBoundingBox(currentStroke, activeTool);
    const newAnnotation: ScreenAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      color: activeColor,
      tool: activeTool,
      points: currentStroke,
      strokeWidth: 4,
      bbox,
      createdAtTime: currentTime,
      startTime: intervalStart,
      endTime: intervalEnd,
    };
    const nextTimeframeAnns = [...timeframeAnnotations, newAnnotation];
    setAnnotations((prev) => [...prev, newAnnotation]);
    setCurrentStroke(null);

    // Automatically advance to the next unused color (simple colors first, then unusual ones)
    if (activeTool !== 'arrow') {
      const nextColor = getNextHighlightColor(nextTimeframeAnns);
      setActiveColor(nextColor);
      setStatusMessage(
        `Added ${MARK_COLORS[activeColor].name} highlight to [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]. Next highlight ready: ${MARK_COLORS[nextColor].name}.`
      );
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

  const handleApplyAiPrompt = async (customPrompt?: string) => {
    const textToCompile = (customPrompt ?? prompt).trim();
    if (!textToCompile) return;

    setIsCompiling(true);
    setStatusMessage(
      `Applying AI edit for timeframe [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
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
          annotations: timeframeAnnotations,
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
        if (!customPrompt) setPrompt('');
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
      if (!draggingHandleRef.current) return;
      const t = getTimeFromTimelineEvent(e.clientX);
      if (draggingHandleRef.current === 'start') {
        setIntervalStart(Math.min(t, intervalEnd - 0.3));
        setCurrentTime(t);
      } else if (draggingHandleRef.current === 'end') {
        setIntervalEnd(Math.max(t, intervalStart + 0.3));
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
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, [getTimeFromTimelineEvent, intervalStart, intervalEnd, videoUrl]);

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

      if (videoUrl && videoRef.current && videoRef.current.readyState >= 2) {
        srcCtx.drawImage(videoRef.current, 0, 0, width, height);
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
      className="flex flex-col h-screen w-screen bg-[#ece5d3] text-[#1d1a16] overflow-hidden"
    >
      {/* Drag-and-Drop Fullscreen Import Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-[#1d1a16]/75 flex items-center justify-center p-8 pointer-events-none">
          <div className="relative bg-[#ece5d3] border-4 border-[#1d1a16] shadow-[8px_8px_0px_#b82d23] p-10 text-center space-y-3">
            <CornerRivets />
            <Upload className="w-12 h-12 mx-auto text-[#b82d23]" />
            <h2 className="text-xl font-bold text-[#1d1a16]">
              Drop High-Definition Video or Project File (.json)
            </h2>
            <p className="text-sm text-[#544b43]">
              Supports MP4, WebM, MOV, and .chromacut.json project timelines
            </p>
          </div>
        </div>
      )}

      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="hidden"
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
        />
      )}

      {/* TOP HEADER BAR (CLEAN & MINIMAL) */}
      <header className="h-13 border-b-2 border-[#1d1a16] bg-[#d9ceb4] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-[#b82d23] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] flex items-center justify-center text-[#ece5d3]">
            <Wand2 className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-base tracking-tight text-[#1d1a16]">
              ChromaCut Studio
            </h1>
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
                    scenic_valley: 'Scenic Valley (1080p HD)',
                    night_express: 'Twilight Express Train (1080p HD)',
                    street_market: 'Festival Market Boulevard (1080p HD)',
                  };
                  setVideoFileName(labels[val as BuiltInSceneId]);
                  setVideoMeta({
                    width: 1920,
                    height: 1080,
                    duration: DEFAULT_DURATION,
                    aspectRatioLabel: '1920×1080 (16:9 HD)',
                    hasAudio: false,
                    isCustomVideo: false,
                  });
                }
              }}
              className="px-2.5 py-1 bg-[#ece5d3] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16] cursor-pointer"
            >
              <option value="scenic_valley">Scene: Scenic Valley</option>
              <option value="night_express">Scene: Night Express</option>
              <option value="street_market">Scene: Festival Market</option>
              {videoUrl && <option value="custom">Video: {videoFileName}</option>}
            </select>
            <span className="text-xs text-[#544b43] hidden xl:inline truncate max-w-md">
              {statusMessage}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadShowcasePreset}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#c6923a] hover:bg-[#dfc992] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-[#1d1a16] text-xs font-bold transition cursor-pointer"
          >
            <span>▶ Demo</span>
          </button>

          <label className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#1d1a16] transition cursor-pointer">
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
            className="p-1.5 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-[#1d1a16] transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-[#50793e]" />
          </button>

          <button
            onClick={() => setShowSettingsModal(true)}
            title="AI API Settings"
            className="p-1.5 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-[#1d1a16] transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#544b43]" />
          </button>

          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#f5f2e8] transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export HD / 4K</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT / CENTER: STAGE, HIGHLIGHT BAR, PROMPT BAR, TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#ece5d3]">
          {/* STREAMLINED HIGHLIGHT TOOLBAR */}
          <div className="h-11 border-b-2 border-[#1d1a16] bg-[#f5f2e8] px-4 flex items-center justify-between gap-3 shrink-0">
            {/* Left: Single "+ Highlight" Button + Active Timeframe Color Pills */}
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={handleCycleHighlightColor}
                title="Just drag on the video to highlight! Each new highlight automatically picks the next unused color (simple colors first, then unusual ones). Click to cycle color."
                className={`flex items-center gap-2 px-3 py-1 text-xs font-bold border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] transition cursor-pointer ${MARK_COLORS[activeColor].badgeBg} ${MARK_COLORS[activeColor].badgeText}`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full border border-[#f5f2e8]"
                  style={{ backgroundColor: MARK_COLORS[activeColor].hex }}
                />
                <span>+ Highlight ({MARK_COLORS[activeColor].name})</span>
              </button>

              {colorSummaries.length > 0 ? (
                <div className="flex items-center gap-1.5 pl-1 border-l-2 border-[#1d1a16]/20">
                  <span className="text-[11px] font-bold text-[#544b43]">
                    In Timeframe:
                  </span>
                  {colorSummaries.map((summary) => {
                    const cfg = MARK_COLORS[summary.color];
                    const isSelected = activeColor === summary.color;
                    return (
                      <div
                        key={summary.color}
                        className={`flex items-center border-2 border-[#1d1a16] text-xs font-bold ${
                          isSelected
                            ? `${cfg.badgeBg} ${cfg.badgeText} shadow-[2px_2px_0px_#1d1a16]`
                            : 'bg-[#ece5d3] text-[#1d1a16]'
                        }`}
                      >
                        <button
                          onClick={() => setActiveColor(summary.color)}
                          title={`Select ${cfg.name} to add another stroke or motion-track it`}
                          className="flex items-center gap-1.5 px-2 py-0.5 cursor-pointer"
                        >
                          <span
                            className="w-2 h-2 rounded-full border border-[#1d1a16]"
                            style={{ backgroundColor: cfg.hex }}
                          />
                          <span>{cfg.name}</span>
                          {summary.isMotionTracked && (
                            <span className="text-[10px]">↗</span>
                          )}
                        </button>
                        <button
                          onClick={() =>
                            setAnnotations((prev) =>
                              prev.filter(
                                (a) =>
                                  !(
                                    isAnnotationInTimeframe(
                                      a,
                                      intervalStart,
                                      intervalEnd
                                    ) && a.color === summary.color
                                  )
                              )
                            )
                          }
                          title={`Remove ${cfg.name} from this timeframe`}
                          className="px-1.5 py-0.5 hover:bg-[#1d1a16]/15 border-l border-[#1d1a16]/40 cursor-pointer"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className="text-xs text-[#544b43]">
                  Drag on the video to highlight areas — colors auto-assign per timeframe
                </span>
              )}
            </div>

            {/* Right: Compact Shape Mode & View Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center bg-[#ece5d3] border-2 border-[#1d1a16] p-0.5">
                {(
                  [
                    { id: 'rect', label: 'Box', icon: Square },
                    { id: 'brush', label: 'Lasso', icon: Brush },
                    { id: 'arrow', label: 'Path', icon: MoveUpRight },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTool(id)}
                    className={`flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold transition cursor-pointer ${
                      activeTool === id
                        ? 'bg-[#1d1a16] text-[#ece5d3]'
                        : 'text-[#544b43] hover:text-[#1d1a16]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {timeframeAnnotations.length > 0 && (
                <button
                  onClick={handleAutoTrackActiveColor}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[#c6923a] hover:bg-[#dfc992] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16] transition cursor-pointer"
                  title="Auto-track highlight across this timeframe"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Track</span>
                </button>
              )}

              <button
                onClick={() => setSplitCompareEnabled((v) => !v)}
                className={`flex items-center gap-1 px-2 py-1 border-2 border-[#1d1a16] text-xs font-bold transition cursor-pointer ${
                  splitCompareEnabled
                    ? 'bg-[#234c7a] text-[#f5f2e8]'
                    : 'bg-[#ece5d3] text-[#1d1a16] hover:bg-[#d9ceb4]'
                }`}
                title="Before / After Split Comparison"
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                <span>Compare</span>
              </button>

              <button
                onClick={() => setShowMarkingsOverlay((v) => !v)}
                title="Show / Hide Highlight Overlays"
                className="p-1 bg-[#ece5d3] hover:bg-[#d9ceb4] border-2 border-[#1d1a16] text-[#1d1a16] cursor-pointer"
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
          <div className="flex-1 relative flex flex-col items-center justify-center p-4 min-h-0 overflow-hidden bg-[#e2d9c3]">
            <div className="relative aspect-video max-h-full max-w-full border-3 border-[#1d1a16] shadow-[6px_6px_0px_#1d1a16] bg-[#ece5d3] overflow-hidden">
              <canvas
                ref={displayCanvasRef}
                className="w-full h-full block object-contain"
              />

              {/* Interactive SVG Drawing Layer (Shows Current Timeframe Highlights) */}
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
                  timeframeAnnotations.map((ann) => {
                    const cfg = MARK_COLORS[ann.color];
                    const bx = ann.bbox.x * 1000;
                    const by = ann.bbox.y * 562.5;
                    const bw = ann.bbox.width * 1000;
                    const bh = ann.bbox.height * 562.5;

                    if (ann.tool === 'arrow' && ann.points.length >= 2) {
                      const p1 = ann.points[0];
                      const p2 = ann.points[ann.points.length - 1];
                      return (
                        <g key={ann.id}>
                          <line
                            x1={p1.x * 1000}
                            y1={p1.y * 562.5}
                            x2={p2.x * 1000}
                            y2={p2.y * 562.5}
                            stroke={cfg.hex}
                            strokeWidth={5}
                            strokeDasharray="10 5"
                          />
                          <circle
                            cx={p2.x * 1000}
                            cy={p2.y * 562.5}
                            r={8}
                            fill={cfg.hex}
                            stroke="#1d1a16"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    }

                    return (
                      <g key={ann.id}>
                        {ann.tool === 'brush' && ann.points.length > 1 ? (
                          <polygon
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={5}
                            strokeLinejoin="round"
                            points={ann.points
                              .map((p) => `${p.x * 1000},${p.y * 562.5}`)
                              .join(' ')}
                          />
                        ) : ann.tool === 'circle' ? (
                          <ellipse
                            cx={bx + bw / 2}
                            cy={by + bh / 2}
                            rx={bw / 2}
                            ry={bh / 2}
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={4}
                            strokeDasharray="8 4"
                          />
                        ) : (
                          <rect
                            x={bx}
                            y={by}
                            width={bw}
                            height={bh}
                            rx={4}
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={4}
                          />
                        )}
                        <rect
                          x={bx}
                          y={Math.max(4, by - 24)}
                          width={76}
                          height={20}
                          fill={cfg.hex}
                          stroke="#1d1a16"
                          strokeWidth={2}
                        />
                        <text
                          x={bx + 38}
                          y={Math.max(18, by - 10)}
                          fill="#f5f2e8"
                          fontSize="10"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {cfg.name.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}

                {currentStroke &&
                  currentStroke.length > 0 &&
                  (() => {
                    const cfg = MARK_COLORS[activeColor];
                    if (activeTool === 'arrow' && currentStroke.length >= 2) {
                      const p1 = currentStroke[0];
                      const p2 = currentStroke[currentStroke.length - 1];
                      return (
                        <line
                          x1={p1.x * 1000}
                          y1={p1.y * 562.5}
                          x2={p2.x * 1000}
                          y2={p2.y * 562.5}
                          stroke={cfg.hex}
                          strokeWidth={5}
                          strokeDasharray="8 4"
                        />
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

                    if (activeTool === 'brush') {
                      return (
                        <polyline
                          fill="none"
                          stroke={cfg.hex}
                          strokeWidth={6}
                          strokeLinecap="round"
                          points={currentStroke
                            .map((p) => `${p.x * 1000},${p.y * 562.5}`)
                            .join(' ')}
                        />
                      );
                    }
                    return (
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        rx={4}
                        fill={cfg.fillRgba}
                        stroke={cfg.hex}
                        strokeWidth={4}
                      />
                    );
                  })()}
              </svg>

              {/* Split-Screen Wipe Slider Bar if Compare is enabled */}
              {splitCompareEnabled && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-[#ece5d3] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] px-3 py-1 flex items-center gap-2">
                  <span className="text-[11px] font-bold">Before/After Wipe:</span>
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

          {/* CLEAN SINGLE-ROW AI PROMPT BAR */}
          <div className="border-t-2 border-[#1d1a16] bg-[#d9ceb4] px-4 py-2 shrink-0">
            <div className="max-w-5xl mx-auto relative bg-[#ece5d3] border-2 border-[#1d1a16] shadow-[3px_3px_0px_#1d1a16] p-2 flex items-center gap-2">
              <CornerRivets />

              <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#234c7a] border-2 border-[#1d1a16] text-xs font-mono font-bold text-[#f5f2e8] shrink-0">
                <Clock className="w-3.5 h-3.5 text-[#fbf09c]" />
                <span>
                  {intervalStart.toFixed(1)}s – {intervalEnd.toFixed(1)}s
                </span>
              </div>

              {colorSummaries.map((cs) => {
                const cfg = MARK_COLORS[cs.color];
                return (
                  <button
                    key={cs.color}
                    onClick={() =>
                      setPrompt((prev) => `${prev} the ${cs.color} area`.trim())
                    }
                    className={`px-2 py-1.5 border-2 border-[#1d1a16] text-xs font-bold transition cursor-pointer shrink-0 ${cfg.badgeBg} ${cfg.badgeText}`}
                    title={`Click to insert "the ${cs.color} area"`}
                  >
                    +{cfg.name}
                  </button>
                );
              })}

              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyAiPrompt();
                }}
                placeholder='Tell AI what to do with your highlighted areas in this timeframe (e.g., "Zoom into red and blur blue")'
                className="flex-1 px-3 py-1.5 bg-[#f5f2e8] border-2 border-[#1d1a16] focus:outline-none text-sm font-medium text-[#1d1a16] placeholder-[#837a6d]"
              />

              <button
                onClick={() => setShowGrimoireModal(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#f5f2e8] hover:bg-[#c6923a] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16] transition cursor-pointer shrink-0"
                title="Browse 1-Click AI Prompt Recipes"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#234c7a]" />
                <span>Recipes</span>
              </button>

              <button
                onClick={() => handleApplyAiPrompt()}
                disabled={isCompiling || !prompt.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-[#b82d23] hover:bg-[#a64147] disabled:opacity-40 border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-sm font-bold text-[#f5f2e8] transition cursor-pointer shrink-0"
              >
                <span>▶ {isCompiling ? 'Applying...' : 'Apply'}</span>
              </button>
            </div>
          </div>

          {/* TIMELINE & SAVED TIMEFRAMES */}
          <div className="h-44 border-t-2 border-[#1d1a16] bg-[#d9ceb4] px-4 py-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex items-center justify-between gap-2">
              {/* Left: Transport Controls */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-7 w-7 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] flex items-center justify-center text-[#f5f2e8] transition cursor-pointer"
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
                    className="h-7 w-7 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] flex items-center justify-center text-[#1d1a16] cursor-pointer"
                  >
                    {isMuted ? (
                      <VolumeX className="w-3.5 h-3.5 text-[#b82d23]" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-[#50793e]" />
                    )}
                  </button>
                )}

                <span className="font-mono text-xs font-bold text-[#1d1a16] bg-[#ece5d3] px-2 py-0.5 border-2 border-[#1d1a16]">
                  {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>

                <button
                  onClick={() => setLoopIntervalOnly((l) => !l)}
                  className={`flex items-center gap-1 px-2 py-0.5 text-xs font-bold border-2 border-[#1d1a16] transition cursor-pointer ${
                    loopIntervalOnly
                      ? 'bg-[#50793e] text-[#f5f2e8]'
                      : 'bg-[#ece5d3] text-[#544b43] hover:text-[#1d1a16]'
                  }`}
                >
                  <Repeat className="w-3 h-3" />
                  <span>Loop</span>
                </button>
              </div>

              {/* Right: Saved Timeframes (Jump back to any timeframe & restore its colors!) */}
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <span className="text-[11px] font-bold text-[#544b43] shrink-0">
                  Timeframes:
                </span>
                {savedTimeframes.map((tf, i) => {
                  const isCurrent =
                    Math.abs(tf.startTime - intervalStart) < 0.1 &&
                    Math.abs(tf.endTime - intervalEnd) < 0.1;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        setIntervalStart(tf.startTime);
                        setIntervalEnd(tf.endTime);
                        setCurrentTime(tf.startTime);
                        setStatusMessage(
                          `Switched to timeframe [${tf.startTime.toFixed(1)}s – ${tf.endTime.toFixed(1)}s] (${tf.colors.length} highlight color${tf.colors.length === 1 ? '' : 's'} restored).`
                        );
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-bold border-2 border-[#1d1a16] transition cursor-pointer shrink-0 ${
                        isCurrent
                          ? 'bg-[#1d1a16] text-[#ece5d3] shadow-[2px_2px_0px_#b82d23]'
                          : 'bg-[#ece5d3] text-[#1d1a16] hover:bg-[#f5f2e8]'
                      }`}
                    >
                      <span>
                        {tf.startTime.toFixed(1)}s–{tf.endTime.toFixed(1)}s
                      </span>
                      <span className="flex items-center gap-0.5">
                        {tf.colors.map((c) => (
                          <span
                            key={c}
                            className="w-2 h-2 rounded-full border border-[#1d1a16]"
                            style={{ backgroundColor: MARK_COLORS[c].hex }}
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={handleStartNewTimeframe}
                  className="px-2 py-0.5 bg-[#c6923a] hover:bg-[#dfc992] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16] cursor-pointer shrink-0"
                  title="Jump to a new timeframe with fresh highlight colors"
                >
                  + New Timeframe
                </button>
              </div>
            </div>

            {/* Interactive Scrubber & Interval Track */}
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
              className="relative flex-1 bg-[#ece5d3] border-2 border-[#1d1a16] shadow-inner overflow-hidden select-none cursor-pointer flex flex-col justify-between p-2"
            >
              {/* Background Audio Waveform Envelope */}
              <div className="pointer-events-none absolute inset-x-2 bottom-1 h-8 flex items-end justify-between gap-[2px] opacity-25">
                {waveformPeaks.map((peak, idx) => {
                  const barTime = (idx / waveformPeaks.length) * duration;
                  const inActiveInterval =
                    barTime >= intervalStart && barTime <= intervalEnd;
                  return (
                    <div
                      key={idx}
                      style={{ height: `${Math.round(peak * 100)}%` }}
                      className={`flex-1 rounded-t-xs ${
                        inActiveInterval ? 'bg-[#b82d23]' : 'bg-[#1d1a16]'
                      }`}
                    />
                  );
                })}
              </div>

              {/* Time Ruler Ticks */}
              <div className="relative z-10 flex justify-between text-[10px] font-mono font-bold text-[#544b43] px-1 pointer-events-none">
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
                className="absolute top-0 bottom-0 bg-[#c6923a]/25 border-x-2 border-[#1d1a16] pointer-events-none"
              >
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'start';
                  }}
                  className="pointer-events-auto absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-9 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] flex items-center justify-center cursor-ew-resize shadow"
                  title="Drag Interval Start"
                >
                  <span className="text-[11px] font-bold text-[#f5f2e8]">[</span>
                </div>

                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'end';
                  }}
                  className="pointer-events-auto absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-9 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] flex items-center justify-center cursor-ew-resize shadow"
                  title="Drag Interval End"
                >
                  <span className="text-[11px] font-bold text-[#f5f2e8]">]</span>
                </div>
              </div>

              {/* Applied AI Edit Blocks on Timeline */}
              <div className="relative flex-1 flex flex-col gap-1 mt-1 overflow-y-auto pr-1">
                {edits.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs font-medium text-[#544b43] pointer-events-none">
                    Drag the red [ ] handles to pick a timeframe, drag on the video to highlight, and type what to edit
                  </div>
                ) : (
                  edits.map((edit) => {
                    const leftPct = (edit.startTime / duration) * 100;
                    const widthPct = Math.max(
                      4,
                      ((edit.endTime - edit.startTime) / duration) * 100
                    );
                    const colorCfg =
                      edit.targetColor && edit.targetColor !== 'all'
                        ? MARK_COLORS[edit.targetColor]
                        : null;

                    return (
                      <div
                        key={edit.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEditId(edit.id);
                          setIntervalStart(edit.startTime);
                          setIntervalEnd(edit.endTime);
                          setCurrentTime(edit.startTime);
                        }}
                        style={{
                          marginLeft: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                        className={`h-6 px-2 flex items-center justify-between text-[11px] font-bold truncate border-2 border-[#1d1a16] transition cursor-pointer ${
                          selectedEditId === edit.id
                            ? 'bg-[#1d1a16] text-[#ece5d3] shadow-[2px_2px_0px_#b82d23]'
                            : colorCfg
                            ? `${colorCfg.badgeBg} ${colorCfg.badgeText}`
                            : 'bg-[#544b43] text-[#ece5d3]'
                        } ${!edit.enabled ? 'opacity-40 line-through' : ''}`}
                      >
                        <span className="truncate">
                          {selectedEditId === edit.id ? '▶ ' : ''}
                          {edit.summary}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Current Time Playhead Line */}
              <div
                style={{ left: `${(currentTime / duration) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#1d1a16] pointer-events-none z-20"
              >
                <div className="w-3.5 h-3.5 -ml-[6px] bg-[#b82d23] border-2 border-[#1d1a16]" />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="w-76 border-l-2 border-[#1d1a16] bg-[#d9ceb4] flex flex-col shrink-0">
          <div className="p-3 border-b-2 border-[#1d1a16] bg-[#b82d23] text-[#f5f2e8] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#fbf09c]" />
              <h2 className="text-xs font-bold uppercase tracking-wider">
                Edits ({edits.length})
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {undoStack.length > 0 && (
                <button
                  onClick={handleUndoEdit}
                  className="text-[11px] text-[#fbf09c] hover:underline font-bold cursor-pointer"
                >
                  ↶ Undo
                </button>
              )}
              {edits.length > 0 && (
                <button
                  onClick={() => {
                    pushEditsWithUndo(() => []);
                    setSelectedEditId(null);
                  }}
                  className="text-[11px] text-[#fbf09c] hover:underline font-bold cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {edits.length === 0 ? (
              <div className="relative bg-[#ece5d3] border-2 border-[#1d1a16] p-5 text-center space-y-2 shadow-[3px_3px_0px_#1d1a16]">
                <CornerRivets />
                <Sparkles className="w-6 h-6 mx-auto text-[#b82d23]" />
                <p className="text-xs font-bold text-[#1d1a16]">
                  Highlight &amp; Edit by Timeframe
                </p>
                <p className="text-[11px] text-[#544b43] leading-relaxed">
                  1. Drag on the video to highlight — simple colors (
                  <strong className="text-[#b82d23]">Red</strong>,{' '}
                  <strong className="text-[#234c7a]">Blue</strong>,{' '}
                  <strong className="text-[#50793e]">Green</strong>,{' '}
                  <strong className="text-[#9a6c24]">Yellow</strong>) assign
                  automatically first, then extended colors!
                  <br />
                  2. Type what AI should do in this timeframe.
                  <br />
                  3. Click any timeframe on the timeline to go back and see its
                  highlights!
                </p>
              </div>
            ) : (
              edits.map((edit) => {
                const isSelected = edit.id === selectedEditId;
                const colorCfg =
                  edit.targetColor && edit.targetColor !== 'all'
                    ? MARK_COLORS[edit.targetColor]
                    : null;

                return (
                  <div
                    key={edit.id}
                    onClick={() => {
                      setSelectedEditId(edit.id);
                      setIntervalStart(edit.startTime);
                      setIntervalEnd(edit.endTime);
                      setCurrentTime(edit.startTime);
                    }}
                    className={`relative p-3 border-2 border-[#1d1a16] transition cursor-pointer ${
                      isSelected
                        ? 'bg-[#f5f2e8] shadow-[3px_3px_0px_#b82d23]'
                        : 'bg-[#ece5d3] hover:bg-[#f5f2e8] shadow-[2px_2px_0px_#1d1a16]'
                    }`}
                  >
                    <CornerRivets />
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isSelected && (
                          <span className="text-xs font-bold text-[#b82d23]">
                            ▶
                          </span>
                        )}
                        {colorCfg && (
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-[#1d1a16] shrink-0"
                            style={{ backgroundColor: colorCfg.hex }}
                          />
                        )}
                        <span className="text-xs font-bold text-[#1d1a16] truncate">
                          {edit.summary}
                        </span>
                      </div>

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
                          className="p-1 hover:bg-[#d9ceb4] text-[#1d1a16] cursor-pointer"
                        >
                          {edit.enabled ? (
                            <Eye className="w-3.5 h-3.5 text-[#50793e]" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-[#837a6d]" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            pushEditsWithUndo((prev) =>
                              prev.filter((item) => item.id !== edit.id)
                            );
                          }}
                          className="p-1 hover:bg-[#b82d23]/20 text-[#b82d23] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#544b43] mt-1 px-1 truncate">
                      &ldquo;{edit.prompt}&rdquo;
                    </p>

                    <div className="flex items-center justify-between mt-2 px-1 text-[10px] font-mono font-bold text-[#544b43]">
                      <span>
                        [{edit.startTime.toFixed(1)}s – {edit.endTime.toFixed(1)}s]
                      </span>
                      <span className="text-[#234c7a] uppercase">
                        {edit.effectType.replace('_', ' ')}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Fine-Tune Selected Edit Inspector */}
          {selectedEdit && (
            <div className="p-3.5 border-t-2 border-[#1d1a16] bg-[#ece5d3] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#1d1a16] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#b82d23]" />
                  Adjust: {selectedEdit.summary}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-[#544b43] block">
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
                  <label className="text-[10px] font-bold text-[#544b43] block">
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
                  <label className="text-[10px] font-bold text-[#544b43] block">
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
                      <label className="text-[10px] font-bold text-[#544b43] block">
                        Blur Strength ({selectedEdit.params.blurRadius ?? 16}px)
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
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1d1a16] cursor-pointer">
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
                    <span>Invert Mask (Apply Outside Marked Area)</span>
                  </label>
                </div>
              )}

              {selectedEdit.effectType === 'text_overlay' && (
                <div>
                  <label className="text-[10px] font-bold text-[#544b43] block mb-1">
                    Callout Text
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
                    className="w-full px-2.5 py-1.5 bg-[#f5f2e8] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16]"
                  />
                </div>
              )}

              {selectedEdit.effectType === 'generative_replace' && (
                <div>
                  <label className="text-[10px] font-bold text-[#544b43] block mb-1">
                    Generative V2V Synthesis Style
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
                    className="w-full px-2.5 py-1.5 bg-[#f5f2e8] border-2 border-[#1d1a16] text-xs font-bold text-[#1d1a16]"
                  >
                    <option value="fire">Fire &amp; Ember Synthesis</option>
                    <option value="hologram">Sci-Fi Hologram Projection</option>
                    <option value="watercolor">Ukiyo-e Watercolor Wash</option>
                    <option value="cyber">Cyber Matrix Pulse</option>
                    <option value="gold_aura">Golden Kitsune Aura</option>
                  </select>
                </div>
              )}

              {selectedEdit.effectType === 'speed' && (
                <div>
                  <label className="text-[10px] font-bold text-[#544b43] block">
                    Playback Speed ({(selectedEdit.params.playbackRate ?? 1.0).toFixed(2)}x)
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

      {/* HIGH-DEFINITION / 4K EXPORT STUDIO MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-[#1d1a16]/65 flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg bg-[#ece5d3] border-3 border-[#1d1a16] p-6 space-y-4 shadow-[6px_6px_0px_#1d1a16]">
            <CornerRivets />
            <div className="flex items-center justify-between border-b-2 border-[#1d1a16] pb-3">
              <h3 className="text-base font-bold text-[#1d1a16] flex items-center gap-2">
                <Download className="w-4 h-4 text-[#b82d23]" />
                High-Definition Video &amp; Frame Export Studio
              </h3>
              <button
                onClick={() => !isExporting && setShowExportModal(false)}
                className="text-xs font-bold text-[#544b43] hover:text-[#1d1a16] cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {/* Output Resolution */}
              <div>
                <label className="font-bold text-[#1d1a16] block mb-1">
                  Output Resolution
                </label>
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
                  className="w-full px-2.5 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] font-bold"
                >
                  <option value="720p">720p HD (1280×720)</option>
                  <option value="1080p">1080p Full HD (1920×1080)</option>
                  <option value="1440p">1440p 2K QHD (2560×1440)</option>
                  <option value="4k">4K Ultra HD (3840×2160)</option>
                  <option value="native">
                    Native Source ({videoMeta.width}×{videoMeta.height})
                  </option>
                </select>
              </div>

              {/* Frame Rate */}
              <div>
                <label className="font-bold text-[#1d1a16] block mb-1">
                  Frame Rate (FPS)
                </label>
                <select
                  value={exportConfig.fps}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      fps: Number(e.target.value) as 24 | 30 | 60,
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] font-bold"
                >
                  <option value={24}>24 FPS (Cinematic)</option>
                  <option value={30}>30 FPS (Standard HD)</option>
                  <option value={60}>60 FPS (Ultra Smooth)</option>
                </select>
              </div>

              {/* Target Bitrate */}
              <div>
                <label className="font-bold text-[#1d1a16] block mb-1">
                  Target Video Bitrate
                </label>
                <select
                  value={exportConfig.bitrateMbps}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      bitrateMbps: Number(e.target.value) as 12 | 24 | 35 | 50,
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] font-bold"
                >
                  <option value={12}>12 Mbps (Standard HD)</option>
                  <option value={24}>24 Mbps (High Definition)</option>
                  <option value={35}>35 Mbps (2K Studio Quality)</option>
                  <option value={50}>50 Mbps (4K Master Quality)</option>
                </select>
              </div>

              {/* Export Range */}
              <div>
                <label className="font-bold text-[#1d1a16] block mb-1">
                  Timeline Range
                </label>
                <select
                  value={exportConfig.range}
                  onChange={(e) =>
                    setExportConfig((prev) => ({
                      ...prev,
                      range: e.target.value as 'full' | 'interval',
                    }))
                  }
                  className="w-full px-2.5 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] font-bold"
                >
                  <option value="full">Full Video (0.0s – {duration.toFixed(1)}s)</option>
                  <option value="interval">
                    Selected Interval Only ({intervalStart.toFixed(1)}s –{' '}
                    {intervalEnd.toFixed(1)}s)
                  </option>
                </select>
              </div>
            </div>

            {isExporting && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-bold">
                  <span>Rendering High-Definition Stream...</span>
                  <span>{exportProgress}%</span>
                </div>
                <div className="w-full h-4 bg-[#d9ceb4] border-2 border-[#1d1a16] overflow-hidden">
                  <div
                    style={{ width: `${exportProgress}%` }}
                    className="h-full bg-[#50793e] transition-all"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t-2 border-[#1d1a16]">
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
                  className="flex items-center gap-1 px-2.5 py-2 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#1d1a16] cursor-pointer"
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
                  title="Export Binary Black/White AI Inpainting Mask PNG"
                  className="flex items-center gap-1 px-2.5 py-2 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#1d1a16] cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#50793e]" />
                  <span>AI Mask PNG</span>
                </button>
              </div>

              <button
                onClick={startHighDefinitionExport}
                disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2 bg-[#b82d23] hover:bg-[#a64147] disabled:opacity-50 border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#f5f2e8] cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {isExporting
                    ? `Rendering (${exportProgress}%)...`
                    : `▶ Render ${exportConfig.resolution.toUpperCase()} Video`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLOUD AI SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-[#1d1a16]/60 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-[#ece5d3] border-3 border-[#1d1a16] p-6 space-y-4 shadow-[6px_6px_0px_#1d1a16]">
            <CornerRivets />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1a16] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#b82d23]" />
                AI Compiler &amp; Future Cloud Model Router
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-xs font-bold text-[#544b43] hover:text-[#1d1a16] cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <div className="p-3 bg-[#50793e]/15 border-2 border-[#50793e] text-xs text-[#1d1a16] flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#50793e] shrink-0 mt-0.5" />
              <div>
                <strong>Built-in Semantic &amp; Trajectory Compiler Active:</strong>{' '}
                Multi-color screen markings, motion-tracked keyframes, and
                stylized shaders work immediately with zero setup!
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#1d1a16] block">
                Optional: Google AI Studio Free Key (Gemini 2.5 Flash Vision)
              </label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy... (Free from aistudio.google.com)"
                className="w-full px-3 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] text-xs text-[#1d1a16]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#1d1a16] block">
                Optional: fal.ai / Replicate Key (SAM 2 + Wan VACE Generative V2V)
              </label>
              <input
                type="password"
                value={falApiKey}
                onChange={(e) => setFalApiKey(e.target.value)}
                placeholder="fal_... (Optional for cloud diffusion inpainting)"
                className="w-full px-3 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] text-xs text-[#1d1a16]"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#f5f2e8] cursor-pointer"
              >
                ▶ Save &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI PROMPT GRIMOIRE & TECHNIQUE EXPLORER MODAL */}
      {showGrimoireModal && (
        <div className="fixed inset-0 z-50 bg-[#1d1a16]/65 flex items-center justify-center p-4">
          <div className="relative w-full max-w-2xl bg-[#ece5d3] border-3 border-[#1d1a16] p-6 space-y-4 shadow-[6px_6px_0px_#1d1a16] max-h-[85vh] overflow-y-auto">
            <CornerRivets />
            <div className="flex items-center justify-between border-b-2 border-[#1d1a16] pb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#234c7a]" />
                <h3 className="text-base font-bold text-[#1d1a16]">
                  AI Visual Prompting Grimoire &amp; Technique Recipes
                </h3>
              </div>
              <button
                onClick={() => setShowGrimoireModal(false)}
                className="text-xs font-bold text-[#544b43] hover:text-[#1d1a16] cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <p className="text-xs text-[#544b43]">
              Click any recipe below to immediately compile &amp; apply it to your
              selected interval{' '}
              <strong>
                [{intervalStart.toFixed(1)}s – {intervalEnd.toFixed(1)}s]
              </strong>
              :
            </p>

            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  title: 'Anime Impact (Multi-Layer Recipe)',
                  badge: '4 LAYERS',
                  badgeColor: 'bg-[#b82d23] text-[#f5f2e8]',
                  desc: 'Expands into Halftone Manga Ink + 1.85x Zoom + Camera Shake + Action Flash.',
                  promptText: `Anime impact on the ${primaryColor} area`,
                },
                {
                  title: 'Bokeh Portrait Depth-of-Field',
                  badge: 'INVERT MASK',
                  badgeColor: 'bg-[#234c7a] text-[#f5f2e8]',
                  desc: 'Keeps your marked subject razor-sharp while Gaussian-blurring the rest of the frame.',
                  promptText: `Blur outside the ${primaryColor} area for bokeh depth-of-field`,
                },
                {
                  title: 'Sin City Selective Color Splash',
                  badge: 'COLOR SPLASH',
                  badgeColor: 'bg-[#50793e] text-[#f5f2e8]',
                  desc: 'Preserves full color inside your marked region and turns the background black & white.',
                  promptText: `Keep the ${primaryColor} area in color and make the background black and white`,
                },
                {
                  title: 'Generative V2V Inpainting Preview',
                  badge: 'V2V SYNTH',
                  badgeColor: 'bg-[#c6923a] text-[#1d1a16]',
                  desc: 'Applies procedural generative synthesis inside your region + prepares SAM 2 / Wan VACE masks.',
                  promptText: `Replace the ${primaryColor} area with fire synthesis`,
                },
                {
                  title: 'Multi-Color Relational Clause',
                  badge: 'MULTI-COLOR',
                  badgeColor: 'bg-[#1d1a16] text-[#ece5d3]',
                  desc: 'Targets two distinct color masks simultaneously in a single natural language sentence.',
                  promptText: `Manga halftone ink on the ${primaryColor} area and blur the ${secondaryColor} area`,
                },
                {
                  title: 'Cyberpunk Chromatic Glitch',
                  badge: 'SHADER FX',
                  badgeColor: 'bg-[#234c7a] text-[#f5f2e8]',
                  desc: 'RGB stereo channel split + scanline wave + 2x smooth camera zoom.',
                  promptText: `Chromatic aberration on the ${primaryColor} area and zoom 2x into the ${primaryColor} area`,
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="bg-[#f5f2e8] border-2 border-[#1d1a16] p-3 flex flex-col justify-between gap-2 shadow-[2px_2px_0px_#1d1a16]"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-xs font-bold text-[#1d1a16]">
                        {item.title}
                      </span>
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 border border-[#1d1a16] ${item.badgeColor}`}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#544b43] leading-snug">
                      {item.desc}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setPrompt(item.promptText);
                      setShowGrimoireModal(false);
                      handleApplyAiPrompt(item.promptText);
                    }}
                    className="w-full py-1.5 bg-[#ece5d3] hover:bg-[#c6923a] border-2 border-[#1d1a16] text-[11px] font-bold text-[#1d1a16] transition cursor-pointer"
                  >
                    ▶ Apply: &ldquo;{item.promptText}&rdquo;
                  </button>
                </div>
              ))}
            </div>

            <div className="p-3 bg-[#d9ceb4] border-2 border-[#1d1a16] text-xs space-y-1">
              <div className="font-bold text-[#1d1a16]">
                Studio Keyboard Shortcuts &amp; Motion Tracking Tips:
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-[#544b43]">
                <span>
                  • <strong>Space</strong>: Play / Pause Video
                </span>
                <span>
                  • <strong>[ / ]</strong>: Set Interval Start / End at Playhead
                </span>
                <span>
                  • <strong>1 / 2 / 3 / 4</strong>: Select Red / Blue / Green / Yellow
                </span>
                <span>
                  • <strong>Ctrl + Z</strong>: Undo Last Timeline Edit
                </span>
                <span>
                  • <strong>AI Track Button</strong>: Optical-flow track color across [start, end]
                </span>
                <span>
                  • <strong>Motion Path Tool</strong>: Draw arrow to glide mask along vector
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
