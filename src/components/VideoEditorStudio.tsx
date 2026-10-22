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
  MousePointerClick,
  Repeat,
  Sliders,
  Clock,
  Layers,
  CheckCircle2,
  Settings,
  Film,
  RotateCcw,
} from 'lucide-react';
import {
  DrawingTool,
  MARK_COLORS,
  MarkColor,
  NormalizedPoint,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';
import { computeBoundingBox, summarizeColorGroups } from '@/lib/editCompiler';
import {
  renderCompositedFrame,
  renderProceduralDemoScene,
} from '@/lib/canvasCompositor';

const DEFAULT_DURATION = 12;

/** Reusable Sumo Brothers 4-Corner Riveted Plaque Decorator */
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('Sumo Brothers Scene (12s)');
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [currentTime, setCurrentTime] = useState<number>(1.5);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loopIntervalOnly, setLoopIntervalOnly] = useState<boolean>(false);

  // Interval selection [startTime, endTime]
  const [intervalStart, setIntervalStart] = useState<number>(1.0);
  const [intervalEnd, setIntervalEnd] = useState<number>(6.0);

  // Screen Drawing / Multi-Color Annotation state
  const [activeColor, setActiveColor] = useState<MarkColor>('red');
  const [activeTool, setActiveTool] = useState<DrawingTool>('rect');
  const [annotations, setAnnotations] = useState<ScreenAnnotation[]>([]);
  const [currentStroke, setCurrentStroke] = useState<NormalizedPoint[] | null>(null);
  const [showMarkingsOverlay, setShowMarkingsOverlay] = useState<boolean>(true);

  // AI Prompt & Timeline Edits state
  const [prompt, setPrompt] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [edits, setEdits] = useState<TimelineEditItem[]>([]);
  const [selectedEditId, setSelectedEditId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(
    'Select an interval [ ], mark objects with Shu-iro Red, Ai-iro Blue, Matcha Green, or Kitsune Gold, and dispatch your edit!'
  );

  // Cloud Settings & Export state
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Refs for rendering loop & interaction
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const draggingHandleRef = useRef<'start' | 'end' | 'playhead' | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

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

      if (isPlaying) {
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
      if (displayCanvas) {
        if (!sourceCanvasRef.current) {
          sourceCanvasRef.current = document.createElement('canvas');
        }
        const srcCanvas = sourceCanvasRef.current;
        const width = 960;
        const height = 540;
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
            renderProceduralDemoScene(srcCtx, width, height, renderTime);
          }

          renderCompositedFrame(
            mainCtx,
            srcCanvas,
            width,
            height,
            currentTime,
            edits
          );
        }
      }

      animationFrameId = requestAnimationFrame(renderTick);
    };

    animationFrameId = requestAnimationFrame(renderTick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    isPlaying,
    currentTime,
    duration,
    intervalStart,
    intervalEnd,
    loopIntervalOnly,
    videoUrl,
    edits,
    getActivePlaybackRate,
  ]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoUrl) return;
    const { rate, freeze } = getActivePlaybackRate(currentTime);
    vid.playbackRate = freeze ? 0.0625 : rate;

    if (isPlaying && vid.paused) {
      vid.play().catch(() => {});
    } else if (!isPlaying && !vid.paused) {
      vid.pause();
    }
  }, [isPlaying, videoUrl, currentTime, getActivePlaybackRate]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
    setIsPlaying(false);
    setCurrentTime(0);
    setStatusMessage(`Loaded "${file.name}". Select an interval and mark areas on screen!`);
  };

  // Load 1-click Sumo Brothers Multi-Color Demo
  const loadShowcasePreset = () => {
    const sampleAnnotations: ScreenAnnotation[] = [
      {
        id: 'sumo-red-postbox',
        color: 'red',
        tool: 'rect',
        points: [
          { x: 0.35, y: 0.29 },
          { x: 0.61, y: 0.86 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.35, y: 0.29, width: 0.26, height: 0.57, cx: 0.48, cy: 0.575 },
        createdAtTime: 2.0,
      },
      {
        id: 'sumo-blue-fighter',
        color: 'blue',
        tool: 'circle',
        points: [
          { x: 0.72, y: 0.38 },
          { x: 0.9, y: 0.74 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.72, y: 0.38, width: 0.18, height: 0.36, cx: 0.81, cy: 0.56 },
        createdAtTime: 2.0,
      },
      {
        id: 'sumo-green-banner',
        color: 'green',
        tool: 'rect',
        points: [
          { x: 0.09, y: 0.2 },
          { x: 0.28, y: 0.68 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.09, y: 0.2, width: 0.19, height: 0.48, cx: 0.185, cy: 0.44 },
        createdAtTime: 2.0,
      },
    ];

    setAnnotations(sampleAnnotations);
    setIntervalStart(1.0);
    setIntervalEnd(6.5);
    setCurrentTime(2.0);
    setPrompt(
      'Add text "NEW QUEST MAIL!" on the red area, make the blue area glow gold, and blur the green area'
    );

    const demoEdits: TimelineEditItem[] = [
      {
        id: 'sumo-edit-1',
        prompt: 'Add text "NEW QUEST MAIL!" on the red area',
        summary: 'Plaque "NEW QUEST MAIL!" @ RED',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'text_overlay',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: {
          text: 'NEW QUEST MAIL!',
          textStyle: 'callout',
          textColor: '#1d1a16',
          fontSize: 28,
        },
        enabled: true,
        aiProvider: 'Sumo Preset',
      },
      {
        id: 'sumo-edit-2',
        prompt: 'Make the blue area glow gold',
        summary: 'Kitsune Glow (#c6923a) → BLUE',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'neon_glow',
        targetColor: 'blue',
        annotations: [sampleAnnotations[1]],
        params: { glowColor: '#c6923a', glowIntensity: 26, pulse: true },
        enabled: true,
        aiProvider: 'Sumo Preset',
      },
      {
        id: 'sumo-edit-3',
        prompt: 'Add viewfinder brackets on the blue area',
        summary: 'Brackets @ BLUE (Sumo Fighter)',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'callout_shape',
        targetColor: 'blue',
        annotations: [sampleAnnotations[1]],
        params: {
          shapeType: 'brackets',
          shapeColor: '#234c7a',
        },
        enabled: true,
        aiProvider: 'Sumo Preset',
      },
      {
        id: 'sumo-edit-4',
        prompt: 'Blur the green area',
        summary: 'Blur → GREEN (Dojo Banner)',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'blur',
        targetColor: 'green',
        annotations: [sampleAnnotations[2]],
        params: { blurRadius: 14, invertMask: false },
        enabled: true,
        aiProvider: 'Sumo Preset',
      },
      {
        id: 'sumo-edit-5',
        prompt: 'Zoom into the red postbox from 7s to 10.5s',
        summary: 'Zoom 1.8x → RED Postbox',
        startTime: 7.0,
        endTime: 10.5,
        effectType: 'zoom',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: { zoomScale: 1.8, zoomEasing: 'smooth' },
        enabled: true,
        aiProvider: 'Sumo Preset',
      },
    ];

    setEdits(demoEdits);
    setSelectedEditId(demoEdits[0].id);
    setIsPlaying(true);
    setStatusMessage(
      'Sumo Brothers Demo Loaded! Red Postbox, Blue Sumo Fighter, and Green Banner are active.'
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
    };
    setAnnotations((prev) => [...prev, newAnnotation]);
    setCurrentStroke(null);
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
    for (const ann of annotations) {
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
    return offscreen.toDataURL('image/png', 0.8);
  };

  const handleApplyAiPrompt = async (customPrompt?: string) => {
    const textToCompile = (customPrompt ?? prompt).trim();
    if (!textToCompile) return;

    setIsCompiling(true);
    setStatusMessage(
      `Dispatching AI edit for interval [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
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
          annotations,
          compositeFrameDataUrl,
          geminiApiKey,
        }),
      });

      const data = await response.json();
      if (data.edits && Array.isArray(data.edits) && data.edits.length > 0) {
        setEdits((prev) => [...prev, ...data.edits]);
        setSelectedEditId(data.edits[0].id);
        setCurrentTime(intervalStart);
        setIsPlaying(true);
        setStatusMessage(
          `Applied ${data.edits.length} edit(s) in [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]`
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

  const handleExportVideo = () => {
    const canvas = displayCanvasRef.current;
    if (!canvas || isExporting) return;

    setIsExporting(true);
    setLoopIntervalOnly(false);
    setCurrentTime(0);
    if (videoRef.current && videoUrl) {
      videoRef.current.currentTime = 0;
    }
    setIsPlaying(true);
    setStatusMessage('Recording edited video stream for export...');

    const stream = canvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = `sumo-brothers-edit-${Date.now()}.webm`;
      a.click();
      setIsExporting(false);
      setIsPlaying(false);
      setStatusMessage('Export complete! Saved edited video.');
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    }, Math.min(duration, 6) * 1000);
  };

  const colorSummaries = summarizeColorGroups(annotations);
  const selectedEdit = edits.find((e) => e.id === selectedEditId) || null;

  const primaryColor = colorSummaries[0]?.color ?? activeColor;
  const secondaryColor =
    colorSummaries[1]?.color ?? (primaryColor === 'red' ? 'blue' : 'red');

  const quickChips = [
    `Zoom into the ${primaryColor} area smoothly`,
    `Blur the ${primaryColor} area and spotlight the ${secondaryColor} area`,
    `Make the ${primaryColor} area glow gold`,
    `Keep the ${primaryColor} area in color and make the background black and white`,
    `Pixelate the ${primaryColor} area and add text "SECRET" on the ${primaryColor} area`,
    `Slow motion 0.5x and add cinema bars`,
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#ece5d3] text-[#1d1a16] overflow-hidden">
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className="hidden"
          playsInline
          muted
          onLoadedMetadata={(e) => {
            const vidDuration = e.currentTarget.duration || 10;
            setDuration(vidDuration);
            setIntervalStart(0);
            setIntervalEnd(Math.min(5, vidDuration));
          }}
        />
      )}

      {/* TOP HEADER BAR — SUMO BROTHERS POSTBOX VERMILION & WASHI STYLE */}
      <header className="h-14 border-b-2 border-[#1d1a16] bg-[#d9ceb4] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {/* Iconic Postbox Red 〒 Stamp */}
          <div className="h-9 w-9 rounded-md bg-[#b82d23] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] flex items-center justify-center font-bold text-lg text-[#ece5d3]">
            〒
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-bold text-lg tracking-tight text-[#1d1a16]">
                Sumo Brothers
              </h1>
              <span className="text-[11px] px-2 py-0.5 bg-[#ece5d3] border border-[#1d1a16] text-[#1d1a16] font-semibold">
                AI Video Editor
              </span>
              <span className="text-xs font-mono text-[#544b43]">v0.0.11</span>
            </div>
            <p className="text-xs text-[#544b43] truncate max-w-lg">
              {statusMessage}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadShowcasePreset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#c6923a] hover:bg-[#dfc992] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] active:translate-y-0.5 text-[#1d1a16] text-xs font-bold transition cursor-pointer"
          >
            <span>▶ Load Sumo Demo</span>
          </button>

          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-semibold text-[#1d1a16] transition cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-[#234c7a]" />
            <span>Open Video File</span>
            <input
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-semibold text-[#1d1a16] transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-[#544b43]" />
            <span>{geminiApiKey ? 'Gemini Active' : 'AI Settings'}</span>
          </button>

          <button
            onClick={handleExportVideo}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#b82d23] hover:bg-[#a64147] disabled:opacity-50 border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#f5f2e8] transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Recording (6s)...' : 'Export Video'}</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT / CENTER: STAGE, DRAWING TOOLBAR, PROMPT PLAQUE, TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#ece5d3]">
          {/* SCREEN MARKING TOOLBAR */}
          <div className="h-12 border-b-2 border-[#1d1a16] bg-[#f5f2e8] px-4 flex items-center justify-between gap-4 shrink-0">
            {/* Sumo Swatch Color Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#544b43] mr-1">
                1. Ink Color:
              </span>
              {(['red', 'blue', 'green', 'yellow'] as MarkColor[]).map(
                (color) => {
                  const cfg = MARK_COLORS[color];
                  const isSelected = activeColor === color;
                  const count = annotations.filter(
                    (a) => a.color === color
                  ).length;
                  return (
                    <button
                      key={color}
                      onClick={() => setActiveColor(color)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border-2 border-[#1d1a16] transition cursor-pointer ${
                        isSelected
                          ? `${cfg.badgeBg} ${cfg.badgeText} shadow-[2px_2px_0px_#1d1a16] -translate-y-0.5`
                          : 'bg-[#ece5d3] text-[#1d1a16] hover:bg-[#d9ceb4]'
                      }`}
                    >
                      {isSelected && <span className="text-[10px]">▶</span>}
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-[#1d1a16]"
                        style={{ backgroundColor: cfg.hex }}
                      />
                      <span>{cfg.name}</span>
                      {count > 0 && (
                        <span className="px-1.5 rounded-sm bg-[#1d1a16] text-[#ece5d3] text-[10px]">
                          {count}
                        </span>
                      )}
                    </button>
                  );
                }
              )}
            </div>

            {/* Drawing Tools */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-[#544b43] mr-1">
                Brush Tool:
              </span>
              {(
                [
                  { id: 'rect', label: 'Box', icon: Square },
                  { id: 'circle', label: 'Enso Circle', icon: Circle },
                  { id: 'brush', label: 'Freehand', icon: Brush },
                  { id: 'arrow', label: 'Point', icon: MousePointerClick },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTool(id)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold border-2 border-[#1d1a16] transition cursor-pointer ${
                    activeTool === id
                      ? 'bg-[#1d1a16] text-[#ece5d3] shadow-[2px_2px_0px_#b82d23]'
                      : 'bg-[#ece5d3] text-[#544b43] hover:text-[#1d1a16]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Canvas Actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowMarkingsOverlay((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#ece5d3] hover:bg-[#d9ceb4] border-2 border-[#1d1a16] text-xs font-semibold text-[#1d1a16] transition cursor-pointer"
              >
                {showMarkingsOverlay ? (
                  <Eye className="w-3.5 h-3.5 text-[#50793e]" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-[#837a6d]" />
                )}
                <span>Marks</span>
              </button>
              <button
                onClick={() => setAnnotations((prev) => prev.slice(0, -1))}
                disabled={annotations.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#ece5d3] hover:bg-[#d9ceb4] disabled:opacity-40 border-2 border-[#1d1a16] text-xs font-semibold text-[#1d1a16] transition cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                onClick={() => setAnnotations([])}
                disabled={annotations.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#b82d23]/15 hover:bg-[#b82d23]/30 disabled:opacity-40 border-2 border-[#1d1a16] text-xs font-bold text-[#b82d23] transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {/* VIDEO CANVAS & INTERACTIVE SVG DRAWING OVERLAY */}
          <div className="flex-1 relative flex items-center justify-center p-4 min-h-0 overflow-hidden bg-[#e2d9c3]">
            <div className="relative aspect-video max-h-full max-w-full border-3 border-[#1d1a16] shadow-[6px_6px_0px_#1d1a16] bg-[#ece5d3] overflow-hidden">
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
                  annotations.map((ann) => {
                    const cfg = MARK_COLORS[ann.color];
                    const bx = ann.bbox.x * 1000;
                    const by = ann.bbox.y * 562.5;
                    const bw = ann.bbox.width * 1000;
                    const bh = ann.bbox.height * 562.5;

                    return (
                      <g key={ann.id}>
                        {ann.tool === 'brush' && ann.points.length > 1 ? (
                          <polyline
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={6}
                            strokeLinecap="round"
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
                        {/* Sumo Plaque Tag */}
                        <rect
                          x={bx}
                          y={Math.max(4, by - 24)}
                          width={78}
                          height={20}
                          fill={cfg.hex}
                          stroke="#1d1a16"
                          strokeWidth={2}
                        />
                        <text
                          x={bx + 39}
                          y={Math.max(18, by - 10)}
                          fill="#f5f2e8"
                          fontSize="11"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {ann.color.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}

                {currentStroke &&
                  currentStroke.length > 0 &&
                  (() => {
                    const cfg = MARK_COLORS[activeColor];
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
                    if (activeTool === 'circle') {
                      return (
                        <ellipse
                          cx={bx + bw / 2}
                          cy={by + bh / 2}
                          rx={bw / 2}
                          ry={bh / 2}
                          fill={cfg.fillRgba}
                          stroke={cfg.hex}
                          strokeWidth={4}
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

              {/* Top-left live HUD status plaque */}
              <div className="absolute top-3 left-3 pointer-events-none flex items-center gap-2">
                <span className="px-2.5 py-1 bg-[#ece5d3]/95 border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-[11px] font-bold text-[#1d1a16] flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-[#b82d23]" />
                  {videoFileName}
                </span>
                {currentTime >= intervalStart && currentTime <= intervalEnd && (
                  <span className="px-2.5 py-1 bg-[#b82d23] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-[11px] font-bold text-[#f5f2e8]">
                    ▶ Interval [{intervalStart.toFixed(1)}s – {intervalEnd.toFixed(1)}s]
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AI INTERVAL PROMPT BAR — RIVETED SUMO PLAQUE */}
          <div className="border-t-2 border-[#1d1a16] bg-[#d9ceb4] px-4 py-3 shrink-0">
            <div className="max-w-5xl mx-auto relative bg-[#ece5d3] border-2 border-[#1d1a16] shadow-[3px_3px_0px_#1d1a16] p-3 flex flex-col gap-2">
              <CornerRivets />

              <div className="flex items-center gap-2">
                {/* Active Interval Stamp */}
                <div className="flex items-center gap-1.5 px-3 py-2 bg-[#234c7a] border-2 border-[#1d1a16] text-xs font-mono font-bold text-[#f5f2e8] shrink-0">
                  <Clock className="w-3.5 h-3.5 text-[#fbf09c]" />
                  <span>
                    {intervalStart.toFixed(1)}s – {intervalEnd.toFixed(1)}s
                  </span>
                </div>

                {/* Clickable Color Reference Pills */}
                {colorSummaries.map((cs) => {
                  const cfg = MARK_COLORS[cs.color];
                  return (
                    <button
                      key={cs.color}
                      onClick={() =>
                        setPrompt((prev) => `${prev} the ${cs.color} area`.trim())
                      }
                      className={`px-2.5 py-1.5 border-2 border-[#1d1a16] text-xs font-bold transition cursor-pointer shrink-0 ${cfg.badgeBg} ${cfg.badgeText}`}
                      title={`Click to insert "the ${cs.color} area"`}
                    >
                      +{cs.color.toUpperCase()}
                    </button>
                  );
                })}

                <div className="relative flex-1">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleApplyAiPrompt();
                    }}
                    placeholder='Tell AI what to do in this interval (e.g., "Zoom into the red area, blur the green area, and make the blue area glow gold")'
                    className="w-full px-3.5 py-2 bg-[#f5f2e8] border-2 border-[#1d1a16] focus:outline-none text-sm font-medium text-[#1d1a16] placeholder-[#837a6d]"
                  />
                </div>

                <button
                  onClick={() => handleApplyAiPrompt()}
                  disabled={isCompiling || !prompt.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#b82d23] hover:bg-[#a64147] disabled:opacity-40 border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-sm font-bold text-[#f5f2e8] transition cursor-pointer shrink-0"
                >
                  <span>▶ {isCompiling ? 'Applying...' : 'Apply to Interval'}</span>
                </button>
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[11px] font-bold text-[#544b43] shrink-0 mr-1">
                  Scrolls:
                </span>
                {quickChips.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setPrompt(chip);
                      handleApplyAiPrompt(chip);
                    }}
                    className="text-[11px] px-2.5 py-0.5 bg-[#f5f2e8] hover:bg-[#c6923a] border border-[#1d1a16] text-[#1d1a16] font-medium transition shrink-0 cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* TIMELINE & INTERVAL SCRUBBER */}
          <div className="h-44 border-t-2 border-[#1d1a16] bg-[#d9ceb4] px-4 py-2.5 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-8 w-8 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] flex items-center justify-center text-[#f5f2e8] transition cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                  )}
                </button>
                <span className="font-mono text-xs font-bold text-[#1d1a16] bg-[#ece5d3] px-2.5 py-1 border-2 border-[#1d1a16]">
                  {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
                </span>

                <button
                  onClick={() => setLoopIntervalOnly((l) => !l)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border-2 border-[#1d1a16] transition cursor-pointer ${
                    loopIntervalOnly
                      ? 'bg-[#50793e] text-[#f5f2e8] shadow-[2px_2px_0px_#1d1a16]'
                      : 'bg-[#ece5d3] text-[#544b43] hover:text-[#1d1a16]'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Loop Interval</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="text-[#544b43]">2. Interval Range:</span>
                <button
                  onClick={() =>
                    setIntervalStart(Math.min(currentTime, intervalEnd - 0.3))
                  }
                  className="px-2.5 py-1 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] text-[#1d1a16] cursor-pointer"
                >
                  Set Start [ = {intervalStart.toFixed(1)}s
                </button>
                <button
                  onClick={() =>
                    setIntervalEnd(Math.max(currentTime, intervalStart + 0.3))
                  }
                  className="px-2.5 py-1 bg-[#ece5d3] hover:bg-[#f5f2e8] border-2 border-[#1d1a16] text-[#1d1a16] cursor-pointer"
                >
                  Set End ] = {intervalEnd.toFixed(1)}s
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
              {/* Time Ruler Ticks */}
              <div className="flex justify-between text-[10px] font-mono font-bold text-[#544b43] px-1 pointer-events-none">
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
                {/* Left Interval Handle */}
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

                {/* Right Interval Handle */}
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
                    Drag the red [ ] handles to select an interval, mark colors on screen, and apply an AI instruction
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

        {/* RIGHT SIDEBAR — RIVETED SUMO POSTBOX MENU PLAQUE */}
        <aside className="w-80 border-l-2 border-[#1d1a16] bg-[#d9ceb4] flex flex-col shrink-0">
          <div className="p-3.5 border-b-2 border-[#1d1a16] bg-[#b82d23] text-[#f5f2e8] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#fbf09c]" />
              <h2 className="text-xs font-bold uppercase tracking-wider">
                Interval Scrolls ({edits.length})
              </h2>
            </div>
            {edits.length > 0 && (
              <button
                onClick={() => {
                  setEdits([]);
                  setSelectedEditId(null);
                }}
                className="text-[11px] text-[#fbf09c] hover:underline font-bold cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Layer List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {edits.length === 0 ? (
              <div className="relative bg-[#ece5d3] border-2 border-[#1d1a16] p-5 text-center space-y-2 shadow-[3px_3px_0px_#1d1a16]">
                <CornerRivets />
                <div className="w-8 h-8 mx-auto rounded-full bg-[#b82d23] border-2 border-[#1d1a16] text-[#ece5d3] font-bold flex items-center justify-center">
                  〒
                </div>
                <p className="text-xs font-bold text-[#1d1a16]">
                  No Interval Scrolls Yet
                </p>
                <p className="text-[11px] text-[#544b43] leading-relaxed">
                  1. Pick an ink color (
                  <strong className="text-[#b82d23]">Red</strong>,{' '}
                  <strong className="text-[#234c7a]">Blue</strong>,{' '}
                  <strong className="text-[#50793e]">Green</strong>,{' '}
                  <strong className="text-[#9a6c24]">Yellow</strong>) and draw on
                  the video.
                  <br />
                  2. Drag the red <strong>[ ]</strong> interval handles.
                  <br />
                  3. Click <strong>▶ Load Sumo Demo</strong> or type a command!
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
                    onClick={() => setSelectedEditId(edit.id)}
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
                            setEdits((prev) =>
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
                            setEdits((prev) =>
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

              {selectedEdit.effectType === 'blur' && (
                <div className="space-y-2">
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
                    <span>Invert Mask (Blur Outside Marked Area)</span>
                  </label>
                </div>
              )}

              {selectedEdit.effectType === 'text_overlay' && (
                <div>
                  <label className="text-[10px] font-bold text-[#544b43] block mb-1">
                    Plaque Text
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
                                summary: `Plaque "${text}"`,
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
            </div>
          )}
        </aside>
      </div>

      {/* CLOUD AI SETTINGS MODAL — SUMO BROTHERS POSTBOX PLAQUE */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-[#1d1a16]/60 flex items-center justify-center p-4">
          <div className="relative w-full max-w-md bg-[#ece5d3] border-3 border-[#1d1a16] p-6 space-y-4 shadow-[6px_6px_0px_#1d1a16]">
            <CornerRivets />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1d1a16] flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#b82d23]" />
                AI Compiler & Cloud Setup
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
                <strong>Built-in Semantic Compiler Active:</strong> Multi-color
                screen markings and interval instructions work immediately for
                free!
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

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 bg-[#b82d23] hover:bg-[#a64147] border-2 border-[#1d1a16] shadow-[2px_2px_0px_#1d1a16] text-xs font-bold text-[#f5f2e8] cursor-pointer"
              >
                ▶ Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
