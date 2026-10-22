# ChromaCut AI — Interval & Multi-Color Visual Prompt Video Editor

An AI-powered video editor where you select a time interval (`[start, end]`), mark screen areas with semantic colors (**Red**, **Blue**, **Green**, **Yellow**), and instruct AI in natural language to apply localized or full-frame video edits.

## Key Features
- **Multi-Color Screen Markings (`Red`, `Blue`, `Green`, `Yellow`)**: Draw boxes, circles, freehand brush masks, or target pointers directly on the video frame and reference them in your prompt (e.g., *"Zoom into the red area, blur the blue area, and make the green area glow neon cyan"*).
- **Timeline Interval Selection (`[start, end]`)**: Drag the interval handles on the timeline and loop the active interval in real time.
- **60 FPS Non-Destructive Canvas Compositor**:
  - Smooth regional Zoom & Pan (`ease-in-out` or instant cut)
  - Regional Masked Gaussian Blur & Mosaic Pixelation (with `invertMask` support for background bokeh blur)
  - Regional Color Grading, Saturation/Grayscale (with `invertMask` for Color Splash), & Color Tinting
  - Spotlight (dim background outside drawn marking)
  - Pulsing Neon / Cyber Glow outlines
  - Anchored Text Callouts & Animated Shapes (Viewfinder Brackets, Dashed Rings, Bouncing Arrows)
  - Playback Speed Control (`0.25x` – `4.0x` & Freeze Frame) and Camera FX (`shake`, `vhs_glitch`, `cinema_bars`, `vignette`, `flash`)
- **Zero-Key Semantic Compiler + Cloud Gemini Vision API**: Works out of the box immediately for free, or connect a free Google AI Studio (`GEMINI_API_KEY`) key for multimodal Set-of-Mark vision compilation.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
