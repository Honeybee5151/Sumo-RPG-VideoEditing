# ChromaCut Studio — AI Interval & Multi-Color Visual Prompt Video Editor

An AI-native video editor designed around **Temporal Intervals (`[t_start, t_end]`)**, **Multi-Color Set-of-Mark Visual Prompting (`Red`, `Blue`, `Green`, `Yellow`)**, **Trajectory & Keyframe Motion Interpolation**, and **True High-Definition / 4K Video Export**.

## Core Capabilities

### 1. Multi-Color Visual Prompting & Motion Keyframe Tracking
- **4 Semantic Ink Colors (`Red #b82d23`, `Blue #234c7a`, `Green #50793e`, `Yellow #c6923a`)**: Draw boxes, circles, freehand brush masks, or **Motion Path Arrows** directly on the video canvas.
- **Automatic Motion Keyframe Interpolation**:
  - Draw a color mark at the start of an interval (e.g., `1.0s`) and a second mark of the same color where the object moves later in the interval (e.g., `5.0s`), OR draw a **Motion Path Arrow**—the engine automatically interpolates (`smoothstep`) the mask, zoom focus, and callouts across every frame!

### 2. AI Strengths & Future-Proof Effect Engine
- **Composite AI Recipes**: Type natural-language creative goals like *"Anime impact on the red area"* to automatically generate a coordinated stack (`Zoom 2.1x` + `Chromatic RGB Split` + `Dramatic Spotlight`).
- **Regional & Full-Frame Shaders**:
  - `zoom`: Smooth ease-in-out or instant cut camera zoom & pan to marked color regions.
  - `blur`: Gaussian blur or Bokeh depth-of-field background blur (via `invertMask`).
  - `pixelate`: Mosaic censor filter inside or outside the marked region.
  - `halftone_ink`: Stylized manga / woodblock halftone dot matrix & ink wash shader.
  - `chromatic_aberration`: Dynamic RGB channel split distortion.
  - `generative_replace`: Future-ready AI V2V synthesis layer (`fire`, `hologram`, `watercolor`, `cyber`, `gold_aura`) with pluggable cloud routing.
  - `color_grade`: Saturation, Color Splash (`invertMask`), sepia, contrast, brightness, and custom color tinting.
  - `spotlight` & `neon_glow`: Dim outside regions or add pulsing aura highlights.
  - `text_overlay` & `callout_shape`: Framed corner-riveted callout plaques, viewfinder brackets, rotating dashed rings, and arrows.
  - `speed` & `camera_fx`: `0.25x–4.0x` speed control, freeze frame, camera shake, VHS glitch, cinema letterbox bars, and vignette.
- **AI Smart Interval Discovery (`✦ AI Suggest Intervals`)**: Automatically proposes key editing intervals and prompt recipes across the video timeline.

### 3. Universal Import & High-Definition / 4K Export Studio
- **Drag-and-Drop Import**: Drop `.mp4`, `.webm`, `.mov`, or `.chromacut.json` project files directly onto the stage. Automatically detects native resolution (`16:9`, `9:16` Vertical Shorts, `1:1`), duration, and audio tracks.
- **3 Built-In 1080p Procedural Scenes**: Switch between `Scenic Valley`, `Twilight Express Train`, and `Festival Market Boulevard`.
- **High-Definition Video & Frame Exporter**:
  - Export video in **720p HD (`1280×720`)**, **1080p Full HD (`1920×1080`)**, **1440p 2K QHD (`2560×1440`)**, **4K Ultra HD (`3840×2160`)**, or **Native Source Resolution** at **24 / 30 / 60 FPS** and up to **50 Mbps** bitrate with synchronized audio muxing.
  - Export crystal-clear **HD / 4K PNG Frame Snapshots** and save/load `.chromacut.json` project timelines.

## Running Locally or as a Desktop App

```bash
npm install
npm run dev
# Or launch the standalone desktop app window:
npm run app
```
