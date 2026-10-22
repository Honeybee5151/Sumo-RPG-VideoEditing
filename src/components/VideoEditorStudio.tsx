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
  Wand2,
  Clock,
  Layers,
  CheckCircle2,
  Settings,
  Film,
  RotateCcw,
  Plus,
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

const DEFAULT_DURATION = 12; // 12-second built-in studio scene

export default function VideoEditorStudio() {
  // Video playback & source state
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string>('Built-in Cyber Studio Scene (12s)');
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
    'Draw with Red, Blue, Green, or Yellow on the video, select a time interval, and tell AI what to edit!'
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

  // Compute active speed multiplier if a 'speed' edit is active at currentTime
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

  // Main 60 FPS Render & Playback Loop
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

      // Render current video or procedural frame into sourceCanvas, then composite effects into displayCanvas
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

  // Sync HTML5 <video> element when playing or scrubbing uploaded video
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

  // Upload custom video file
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoFileName(file.name);
    setIsPlaying(false);
    setCurrentTime(0);
    setStatusMessage(`Loaded "${file.name}". Select an interval and draw on screen!`);
  };

  // Load 1-click showcase demo with multi-color annotations + interval edits
  const loadShowcasePreset = () => {
    const sampleAnnotations: ScreenAnnotation[] = [
      {
        id: 'demo-red-car',
        color: 'red',
        tool: 'rect',
        points: [
          { x: 0.62, y: 0.59 },
          { x: 0.87, y: 0.79 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.62, y: 0.59, width: 0.25, height: 0.2, cx: 0.745, cy: 0.69 },
        createdAtTime: 2.0,
      },
      {
        id: 'demo-blue-bot',
        color: 'blue',
        tool: 'circle',
        points: [
          { x: 0.37, y: 0.36 },
          { x: 0.54, y: 0.68 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.37, y: 0.36, width: 0.17, height: 0.32, cx: 0.455, cy: 0.52 },
        createdAtTime: 2.0,
      },
      {
        id: 'demo-green-sign',
        color: 'green',
        tool: 'rect',
        points: [
          { x: 0.07, y: 0.14 },
          { x: 0.31, y: 0.4 },
        ],
        strokeWidth: 4,
        bbox: { x: 0.07, y: 0.14, width: 0.24, height: 0.26, cx: 0.19, cy: 0.27 },
        createdAtTime: 2.0,
      },
    ];

    setAnnotations(sampleAnnotations);
    setIntervalStart(1.0);
    setIntervalEnd(6.5);
    setCurrentTime(2.2);
    setPrompt(
      'Make the green area glow neon cyan, add text "TARGET LOCKED" on the red area, and blur the blue area'
    );

    const demoEdits: TimelineEditItem[] = [
      {
        id: 'demo-edit-1',
        prompt: 'Make the green area glow neon cyan',
        summary: 'Neon Glow (#06b6d4) on GREEN',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'neon_glow',
        targetColor: 'green',
        annotations: [sampleAnnotations[2]],
        params: { glowColor: '#06b6d4', glowIntensity: 28, pulse: true },
        enabled: true,
        aiProvider: 'Showcase Preset',
      },
      {
        id: 'demo-edit-2',
        prompt: 'Add text "TARGET LOCKED" on the red area',
        summary: 'Text "TARGET LOCKED" @ RED',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'text_overlay',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: {
          text: 'TARGET LOCKED',
          textStyle: 'callout',
          textColor: '#f87171',
          fontSize: 28,
        },
        enabled: true,
        aiProvider: 'Showcase Preset',
      },
      {
        id: 'demo-edit-3',
        prompt: 'Add brackets on the red area',
        summary: 'Animated brackets @ RED',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'callout_shape',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: {
          shapeType: 'brackets',
          shapeColor: '#ef4444',
        },
        enabled: true,
        aiProvider: 'Showcase Preset',
      },
      {
        id: 'demo-edit-4',
        prompt: 'Blur the blue area',
        summary: 'Gaussian Blur → BLUE',
        startTime: 1.0,
        endTime: 6.5,
        effectType: 'blur',
        targetColor: 'blue',
        annotations: [sampleAnnotations[1]],
        params: { blurRadius: 16, invertMask: false },
        enabled: true,
        aiProvider: 'Showcase Preset',
      },
      {
        id: 'demo-edit-5',
        prompt: 'Zoom into the red area from 7s to 10.5s',
        summary: 'Zoom 1.9x → RED mark',
        startTime: 7.0,
        endTime: 10.5,
        effectType: 'zoom',
        targetColor: 'red',
        annotations: [sampleAnnotations[0]],
        params: { zoomScale: 1.9, zoomEasing: 'smooth' },
        enabled: true,
        aiProvider: 'Showcase Preset',
      },
    ];

    setEdits(demoEdits);
    setSelectedEditId(demoEdits[0].id);
    setIsPlaying(true);
    setStatusMessage(
      'Loaded Multi-Color Showcase! Watch how Red, Blue, and Green markings drive localized edits across [1.0s – 6.5s] and [7.0s – 10.5s].'
    );
  };

  // Drawing Canvas Pointer Handlers
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

  // Capture a composite visual prompt image (video frame + colored annotations drawn on top)
  const captureCompositeVisualPrompt = (): string | undefined => {
    const displayCanvas = displayCanvasRef.current;
    if (!displayCanvas) return undefined;
    const offscreen = document.createElement('canvas');
    offscreen.width = 640;
    offscreen.height = 360;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(displayCanvas, 0, 0, 640, 360);
    // Overlay colored markings so the Multimodal Vision LLM sees the Set-of-Mark annotations
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
      ctx.roundRect(bx, by, bw, bh, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = colorCfg.hex;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(ann.color.toUpperCase(), bx + 4, Math.max(14, by - 4));
      ctx.restore();
    }
    return offscreen.toDataURL('image/png', 0.8);
  };

  // Submit AI Prompt for Selected Interval + Colored Markings
  const handleApplyAiPrompt = async (customPrompt?: string) => {
    const textToCompile = (customPrompt ?? prompt).trim();
    if (!textToCompile) return;

    setIsCompiling(true);
    setStatusMessage(
      `Compiling edits for interval [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s]...`
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
          `Added ${data.edits.length} AI edit(s) in [${intervalStart.toFixed(1)}s – ${intervalEnd.toFixed(1)}s] via ${data.provider}`
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

  // Timeline Scrubber & Interval Dragging
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

  // Export Composited Video via Canvas MediaRecorder Stream
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
      a.download = `chromacut-edited-${Date.now()}.webm`;
      a.click();
      setIsExporting(false);
      setIsPlaying(false);
      setStatusMessage('Export complete! Downloaded edited video.');
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

  // Dynamic quick suggestions tailored to drawn colors
  const primaryColor = colorSummaries[0]?.color ?? activeColor;
  const secondaryColor = colorSummaries[1]?.color ?? (primaryColor === 'red' ? 'blue' : 'red');

  const quickChips = [
    `Zoom into the ${primaryColor} area smoothly`,
    `Blur the ${primaryColor} area and spotlight the ${secondaryColor} area`,
    `Make the ${primaryColor} area glow neon purple`,
    `Keep the ${primaryColor} area in color and make the background black and white`,
    `Pixelate the ${primaryColor} area and add text "CENSORED" on the ${primaryColor} area`,
    `Slow motion 0.5x and add cinema bars`,
  ];

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090a0f] text-gray-100 overflow-hidden">
      {/* Hidden <video> element for uploaded user video files */}
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

      {/* TOP HEADER BAR */}
      <header className="h-14 border-b border-white/10 bg-[#10121c] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-white">
                ChromaCut AI
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-medium">
                Interval + Color Visual Prompt Studio
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate max-w-md">
              {statusMessage}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={loadShowcasePreset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-pink-500/20 hover:from-amber-500/30 hover:to-pink-500/30 border border-amber-400/40 text-amber-200 text-xs font-medium transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            Load Multi-Color Demo
          </button>

          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-200 transition cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>Upload Video</span>
            <input
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="hidden"
            />
          </label>

          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-gray-400" />
            <span>{geminiApiKey ? 'Gemini Cloud Active' : 'Cloud AI Setup'}</span>
          </button>

          <button
            onClick={handleExportVideo}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/25 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Recording (6s)...' : 'Export Video'}</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE: STAGE + RIGHT INSPECTOR */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* LEFT / CENTER: VIDEO STAGE, DRAWING TOOLBAR, PROMPT BAR, TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0b0d14]">
          {/* SCREEN MARKING TOOLBAR */}
          <div className="h-12 border-b border-white/10 bg-[#121521] px-4 flex items-center justify-between gap-4 shrink-0">
            {/* Color Palette Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-400 mr-1">
                1. Mark Screen Color:
              </span>
              {(['red', 'blue', 'green', 'yellow'] as MarkColor[]).map((color) => {
                const cfg = MARK_COLORS[color];
                const isSelected = activeColor === color;
                const count = annotations.filter((a) => a.color === color).length;
                return (
                  <button
                    key={color}
                    onClick={() => setActiveColor(color)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      isSelected
                        ? `${cfg.badgeBg} ${cfg.badgeText} ring-2 ring-white/30 scale-105`
                        : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: cfg.hex }}
                    />
                    <span>{cfg.name}</span>
                    {count > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-black/40 text-[10px]">
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Drawing Shape Tools */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-gray-400 mr-1">
                Shape:
              </span>
              {(
                [
                  { id: 'rect', label: 'Box', icon: Square },
                  { id: 'circle', label: 'Circle', icon: Circle },
                  { id: 'brush', label: 'Brush', icon: Brush },
                  { id: 'arrow', label: 'Target', icon: MousePointerClick },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTool(id)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
                    activeTool === id
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
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
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 transition cursor-pointer"
                title="Show or hide drawn screen markings"
              >
                {showMarkingsOverlay ? (
                  <Eye className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-gray-500" />
                )}
                <span>Marks</span>
              </button>
              <button
                onClick={() => setAnnotations((prev) => prev.slice(0, -1))}
                disabled={annotations.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/10 text-xs text-gray-300 transition cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                onClick={() => setAnnotations([])}
                disabled={annotations.length === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 border border-red-500/30 text-xs text-red-300 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Clear Marks</span>
              </button>
            </div>
          </div>

          {/* VIDEO CANVAS & INTERACTIVE SVG DRAWING OVERLAY */}
          <div className="flex-1 relative flex items-center justify-center p-4 min-h-0 overflow-hidden">
            <div className="relative aspect-video max-h-full max-w-full rounded-xl overflow-hidden shadow-2xl border border-white/15 bg-black">
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
                            rx={10}
                            fill={cfg.fillRgba}
                            stroke={cfg.hex}
                            strokeWidth={4}
                          />
                        )}
                        {/* Color Semantic Tag Pill */}
                        <rect
                          x={bx}
                          y={Math.max(4, by - 24)}
                          width={74}
                          height={20}
                          rx={5}
                          fill={cfg.hex}
                        />
                        <text
                          x={bx + 37}
                          y={Math.max(18, by - 10)}
                          fill="#ffffff"
                          fontSize="11"
                          fontWeight="bold"
                          textAnchor="middle"
                        >
                          {ann.color.toUpperCase()}
                        </text>
                      </g>
                    );
                  })}

                {/* Active Stroke Preview while dragging */}
                {currentStroke &&
                  currentStroke.length > 0 &&
                  (() => {
                    const cfg = MARK_COLORS[activeColor];
                    const previewBox = computeBoundingBox(currentStroke, activeTool);
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
                        rx={10}
                        fill={cfg.fillRgba}
                        stroke={cfg.hex}
                        strokeWidth={4}
                      />
                    );
                  })()}
              </svg>

              {/* Top-left live HUD status pill */}
              <div className="absolute top-3 left-3 pointer-events-none flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-black/70 backdrop-blur-md border border-white/15 text-[11px] font-mono text-gray-200 flex items-center gap-1.5">
                  <Film className="w-3 h-3 text-indigo-400" />
                  {videoFileName}
                </span>
                {currentTime >= intervalStart && currentTime <= intervalEnd && (
                  <span className="px-2.5 py-1 rounded-md bg-indigo-600/80 backdrop-blur-md text-[11px] font-semibold text-white">
                    Inside Interval [{intervalStart.toFixed(1)}s – {intervalEnd.toFixed(1)}s]
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* AI INTERVAL PROMPT BAR */}
          <div className="border-t border-white/10 bg-[#131624] px-4 py-3 shrink-0">
            <div className="max-w-5xl mx-auto flex flex-col gap-2">
              {/* Prompt Input Row */}
              <div className="flex items-center gap-2">
                {/* Active Interval Badge */}
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-500/15 border border-indigo-500/40 text-xs font-mono text-indigo-200 shrink-0">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
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
                        setPrompt((prev) =>
                          `${prev} the ${cs.color} area`.trim()
                        )
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition cursor-pointer shrink-0 ${cfg.badgeBg} ${cfg.badgeText}`}
                      title={`Click to insert "the ${cs.color} area" into your prompt`}
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
                    placeholder='Tell AI what to do in this interval (e.g., "Zoom into the red area, blur the blue area, and make the green area glow neon cyan")'
                    className="w-full px-4 py-2.5 rounded-xl bg-[#0b0d16] border border-white/15 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder-gray-500"
                  />
                </div>

                <button
                  onClick={() => handleApplyAiPrompt()}
                  disabled={isCompiling || !prompt.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer shrink-0"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isCompiling ? 'Applying...' : 'Apply to Interval'}</span>
                </button>
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                <span className="text-[11px] text-gray-400 shrink-0 mr-1">
                  Try prompt:
                </span>
                {quickChips.map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setPrompt(chip);
                      handleApplyAiPrompt(chip);
                    }}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white/5 hover:bg-indigo-500/20 border border-white/10 hover:border-indigo-500/40 text-gray-300 hover:text-indigo-200 transition shrink-0 cursor-pointer"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* TIMELINE & INTERVAL SCRUBBER */}
          <div className="h-44 border-t border-white/10 bg-[#0e101a] px-4 py-2.5 flex flex-col gap-2 shrink-0">
            {/* Timeline Controls Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="h-8 w-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-white transition cursor-pointer"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                  )}
                </button>
                <span className="font-mono text-xs text-gray-200 bg-white/5 px-2.5 py-1 rounded-md border border-white/10">
                  {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
                </span>

                <button
                  onClick={() => setLoopIntervalOnly((l) => !l)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition cursor-pointer ${
                    loopIntervalOnly
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Loop Interval</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400">2. Selected Interval:</span>
                <button
                  onClick={() =>
                    setIntervalStart(Math.min(currentTime, intervalEnd - 0.3))
                  }
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 cursor-pointer"
                >
                  Set Start [ = {intervalStart.toFixed(1)}s
                </button>
                <button
                  onClick={() =>
                    setIntervalEnd(Math.max(currentTime, intervalStart + 0.3))
                  }
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 cursor-pointer"
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
              className="relative flex-1 rounded-xl bg-[#08090f] border border-white/10 overflow-hidden select-none cursor-pointer flex flex-col justify-between p-2"
            >
              {/* Time Ruler Ticks */}
              <div className="flex justify-between text-[10px] font-mono text-gray-500 px-1 pointer-events-none">
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
                className="absolute top-0 bottom-0 bg-indigo-500/15 border-x-2 border-indigo-400 pointer-events-none"
              >
                {/* Left Interval Handle */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'start';
                  }}
                  className="pointer-events-auto absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-9 rounded-md bg-indigo-500 hover:bg-indigo-400 border border-white/50 flex items-center justify-center cursor-ew-resize shadow-lg"
                  title="Drag Interval Start"
                >
                  <span className="text-[10px] font-bold text-white">[</span>
                </div>

                {/* Right Interval Handle */}
                <div
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingHandleRef.current = 'end';
                  }}
                  className="pointer-events-auto absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-9 rounded-md bg-indigo-500 hover:bg-indigo-400 border border-white/50 flex items-center justify-center cursor-ew-resize shadow-lg"
                  title="Drag Interval End"
                >
                  <span className="text-[10px] font-bold text-white">]</span>
                </div>
              </div>

              {/* Applied AI Edit Blocks on Timeline */}
              <div className="relative flex-1 flex flex-col gap-1 mt-1 overflow-y-auto pr-1">
                {edits.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-500 pointer-events-none">
                    Drag the purple [ ] handles to choose an interval, draw colors on the video, and enter an AI prompt above
                  </div>
                ) : (
                  edits.map((edit) => {
                    const leftPct = (edit.startTime / duration) * 100;
                    const widthPct = Math.max(
                      3,
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
                        className={`h-6 rounded-md px-2 flex items-center justify-between text-[11px] font-medium truncate border transition cursor-pointer ${
                          selectedEditId === edit.id
                            ? 'ring-2 ring-white bg-indigo-600/50 border-indigo-300 text-white'
                            : colorCfg
                            ? `${colorCfg.badgeBg} ${colorCfg.badgeText}`
                            : 'bg-purple-500/25 border-purple-400/40 text-purple-200'
                        } ${!edit.enabled ? 'opacity-40 line-through' : ''}`}
                      >
                        <span className="truncate">{edit.summary}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Current Time Playhead Line */}
              <div
                style={{ left: `${(currentTime / duration) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 pointer-events-none z-20"
              >
                <div className="w-3 h-3 -ml-[5px] rounded-full bg-amber-400 shadow" />
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT SIDEBAR: INTERVAL EDITS & PARAMETER INSPECTOR */}
        <aside className="w-80 border-l border-white/10 bg-[#10131f] flex flex-col shrink-0">
          <div className="p-3.5 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-200">
                AI Interval Layers ({edits.length})
              </h2>
            </div>
            {edits.length > 0 && (
              <button
                onClick={() => {
                  setEdits([]);
                  setSelectedEditId(null);
                }}
                className="text-[11px] text-gray-400 hover:text-red-400 transition cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Layer List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {edits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-5 text-center space-y-2">
                <Sparkles className="w-6 h-6 text-indigo-400 mx-auto opacity-75" />
                <p className="text-xs font-medium text-gray-300">
                  No AI Interval Edits Yet
                </p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  1. Pick a color (<span className="text-red-400">Red</span>,{' '}
                  <span className="text-blue-400">Blue</span>,{' '}
                  <span className="text-emerald-400">Green</span>,{' '}
                  <span className="text-yellow-400">Yellow</span>) and draw on
                  the screen.
                  <br />
                  2. Adjust the <span className="text-indigo-300">[ ]</span>{' '}
                  interval handles on the timeline.
                  <br />
                  3. Type what should happen in that interval or click{' '}
                  <strong className="text-amber-300">Load Multi-Color Demo</strong>!
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
                    className={`p-3 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500/60'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {colorCfg && (
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: colorCfg.hex }}
                          />
                        )}
                        <span className="text-xs font-semibold text-white truncate">
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
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                        >
                          {edit.enabled ? (
                            <Eye className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEdits((prev) =>
                              prev.filter((item) => item.id !== edit.id)
                            );
                          }}
                          className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-gray-400 mt-1 truncate">
                      &ldquo;{edit.prompt}&rdquo;
                    </p>

                    <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-gray-400">
                      <span>
                        [{edit.startTime.toFixed(1)}s – {edit.endTime.toFixed(1)}s]
                      </span>
                      <span className="text-indigo-300 uppercase">
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
            <div className="p-3.5 border-t border-white/10 bg-[#0c0e18] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  Inspector: {selectedEdit.summary}
                </span>
              </div>

              {/* Interval Start / End Sliders */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-[10px] text-gray-400 block">
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
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 block">
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
                    className="w-full accent-indigo-500"
                  />
                </div>
              </div>

              {/* Effect-Specific Controls */}
              {selectedEdit.effectType === 'zoom' && (
                <div>
                  <label className="text-[10px] text-gray-400 block">
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
                    className="w-full accent-indigo-500"
                  />
                </div>
              )}

              {selectedEdit.effectType === 'blur' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-400 block">
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
                      className="w-full accent-indigo-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
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
                  <label className="text-[10px] text-gray-400 block mb-1">
                    Overlay Text
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
                                summary: `Text "${text}"`,
                                params: { ...it.params, text },
                              }
                            : it
                        )
                      );
                    }}
                    className="w-full px-2.5 py-1.5 rounded bg-black/50 border border-white/15 text-xs text-white"
                  />
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* CLOUD AI SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#131726] border border-white/15 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                Cloud AI & Free Server Configuration
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-xs text-gray-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong>Built-in Semantic Compiler is Active:</strong> You can
                use multi-color screen markings and interval prompts right now
                with zero setup!
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-300 block">
                Optional: Google AI Studio Free Tier Key (Gemini 2.5 Flash Vision)
              </label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="AIzaSy... (Free from aistudio.google.com)"
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/15 text-xs text-white"
              />
              <p className="text-[11px] text-gray-400">
                When provided, ChromaCut sends a composite visual snapshot of
                the video frame + your colored markings to Gemini Vision in the
                cloud.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
              >
                Save & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
