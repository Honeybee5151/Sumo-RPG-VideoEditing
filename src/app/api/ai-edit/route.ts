import { NextRequest, NextResponse } from 'next/server';
import { compilePromptLocally, summarizeColorGroups } from '@/lib/editCompiler';
import {
  COLOR_PROGRESSION,
  EffectType,
  MarkColor,
  ScreenAnnotation,
  TimelineEditItem,
} from '@/types/editor';

interface AiEditRequestBody {
  prompt: string;
  startTime: number;
  endTime: number;
  annotations: ScreenAnnotation[];
  compositeFrameDataUrl?: string;
  geminiApiKey?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AiEditRequestBody;
    const {
      prompt,
      startTime = 0,
      endTime = 5,
      annotations = [],
      compositeFrameDataUrl,
      geminiApiKey,
    } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const activeKey = (geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    const colorSummary = summarizeColorGroups(annotations);

    if (activeKey) {
      try {
        const systemInstruction = `You are an expert AI Video Editor Compiler.
The user has selected a time interval [${startTime.toFixed(2)}s, ${endTime.toFixed(2)}s] and drawn colored markings on the screen:
${
  colorSummary.length > 0
    ? colorSummary
        .map(
          (c) =>
            `- ${c.color.toUpperCase()}: ${c.count} stroke(s) (${c.tools.join(', ')}), motionTracked=${c.isMotionTracked}, bbox=[x:${c.combinedBbox.x.toFixed(2)}, y:${c.combinedBbox.y.toFixed(2)}, w:${c.combinedBbox.width.toFixed(2)}, h:${c.combinedBbox.height.toFixed(2)}]`
        )
        .join('\n')
    : '- No color markings drawn (apply to full frame or default region).'
}

Translate the user's instruction into a JSON array of edit operations.
Allowed effectType values:
- "zoom": params { zoomScale: number (1.2-3.5), zoomEasing: "smooth" | "instant" }
- "blur": params { blurRadius: number (8-32), invertMask?: boolean }
- "pixelate": params { pixelBlockSize: number (8-28), invertMask?: boolean }
- "spotlight": params { dimOpacity: number (0.4-0.88) }
- "color_grade": params { saturation?: number (0-250), brightness?: number (50-160), contrast?: number (50-200), sepia?: number (0-100), invert?: number (0-100), hueRotate?: number (0-360), tintColor?: string (hex), tintOpacity?: number (0.2-0.8), invertMask?: boolean }
- "neon_glow": params { glowColor: string (hex), glowIntensity: number (12-40), pulse: boolean }
- "halftone_ink": params { dotSpacing: number (5-12), inkColor: string (hex), paperColor: string (hex), invertMask?: boolean }
- "chromatic_aberration": params { aberrationOffset: number (4-18), invertMask?: boolean }
- "generative_replace": params { generativePrompt: string, generativeStyle: "fire" | "hologram" | "watercolor" | "cyber" | "gold_aura" }
- "text_overlay": params { text: string, textStyle: "impact" | "callout" | "neon", textColor: string (hex), fontSize: number (24-48) }
- "callout_shape": params { shapeType: "ring" | "brackets" | "arrow", shapeColor: string (hex) }
- "speed": params { playbackRate: number (0.25-4.0), freezeFrame?: boolean }
- "camera_fx": params { cameraEffect: "shake" | "vignette" | "cinema_bars" | "vhs_glitch" | "flash", intensity?: number }

Each item in the returned JSON array MUST have:
{
  "summary": "Short human-readable label (e.g. 'Zoom 2.0x -> RED', 'Manga Ink -> GREEN')",
  "effectType": EffectType,
  "targetColor": "red" | "blue" | "green" | "yellow" | "purple" | "cyan" | "orange" | "pink" | "all",
  "params": { ... }
}
Return ONLY valid JSON array.`;

        const parts: Array<Record<string, unknown>> = [
          { text: `${systemInstruction}\n\nUser Prompt: "${prompt}"` },
        ];

        if (compositeFrameDataUrl && compositeFrameDataUrl.startsWith('data:image/')) {
          const [meta, base64Data] = compositeFrameDataUrl.split(',');
          const mimeMatch = meta.match(/data:(image\/[a-zA-Z0-9+.-]+);base64/);
          if (base64Data) {
            parts.push({
              inline_data: {
                mime_type: mimeMatch ? mimeMatch[1] : 'image/png',
                data: base64Data,
              },
            });
          }
        }

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
            activeKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.15,
              },
            }),
          }
        );

        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const rawText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
          const parsed = JSON.parse(rawText);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const edits: TimelineEditItem[] = parsed.map((item, idx) => {
              const targetColor: MarkColor | 'all' = COLOR_PROGRESSION.includes(
                item.targetColor
              )
                ? item.targetColor
                : annotations.length === 1
                ? annotations[0].color
                : 'all';

              const matchingAnnotations =
                targetColor === 'all'
                  ? annotations
                  : annotations.filter((a) => a.color === targetColor);

              return {
                id: `gemini-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
                prompt,
                summary: item.summary || `${item.effectType} (${targetColor})`,
                startTime,
                endTime,
                effectType: (item.effectType as EffectType) || 'color_grade',
                targetColor,
                annotations: matchingAnnotations,
                params: item.params || {},
                enabled: true,
                aiProvider: 'Gemini 2.5 Flash Vision (Cloud)',
              };
            });

            return NextResponse.json({
              edits,
              provider: 'Gemini 2.5 Flash Vision (Cloud)',
            });
          }
        }
      } catch (cloudErr) {
        console.warn('Gemini Vision API fallback to local semantic compiler:', cloudErr);
      }
    }

    const edits = compilePromptLocally(
      prompt,
      startTime,
      endTime,
      annotations,
      'Built-in Semantic Compiler'
    );

    return NextResponse.json({
      edits,
      provider: 'Built-in Semantic Compiler',
    });
  } catch (err) {
    console.error('Error in /api/ai-edit:', err);
    return NextResponse.json(
      { error: 'Failed to compile AI video edit' },
      { status: 500 }
    );
  }
}
