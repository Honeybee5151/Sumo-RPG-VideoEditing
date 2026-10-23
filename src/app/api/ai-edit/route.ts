import { NextRequest, NextResponse } from 'next/server';
import http from 'http';
import https from 'https';
import dns from 'dns';
import {
  AiEditorContextInput,
  buildAiEditorSystemPrompt,
  parseAiEditResponse,
} from '@/lib/aiContext';
import { compilePromptLocally } from '@/lib/editCompiler';
import {
  AI_PROVIDER_CATALOG,
  AiProviderId,
  AiReasoningEffort,
  EffectType,
  ImageGenModeId,
  MarkColor,
  ScreenAnnotation,
} from '@/types/editor';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Ignore if unsupported
}

function postJsonRequest(
  urlStr: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs = 45000
): Promise<{
  status: number;
  ok: boolean;
  text: string;
  buffer: Buffer;
  contentType: string;
}> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyBuffer = Buffer.from(JSON.stringify(payload), 'utf8');

    const req = lib.request(
      parsedUrl,
      {
        method: 'POST',
        family: 4,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': String(bodyBuffer.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const text = buffer.toString('utf8');
          const status = res.statusCode || 500;
          const contentType = String(res.headers['content-type'] || '');
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text,
            buffer,
            contentType,
          });
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    req.write(bodyBuffer);
    req.end();
  });
}

interface AiEditRequestBody {
  mode?: 'edit' | 'test' | 'draw_image';
  prompt?: string;
  startTime?: number;
  endTime?: number;
  currentTime?: number;
  duration?: number;
  focusedColor?: MarkColor | 'all';
  annotations?: ScreenAnnotation[];
  allAnnotations?: ScreenAnnotation[];
  existingEdits?: Array<{
    id: string;
    summary: string;
    effectType: EffectType;
    targetColor?: MarkColor | 'all';
    startTime: number;
    endTime: number;
  }>;
  splitPoints?: number[];
  cuts?: Array<{ startTime: number; endTime: number }>;
  mediaFileName?: string;
  mediaCategory?: 'video' | 'image' | 'audio';
  compositeFrameDataUrl?: string;
  projectSounds?: Array<{
    id: string;
    name: string;
    durationSec?: number;
  }>;
  // AI Provider configuration
  provider?: AiProviderId;
  model?: string;
  apiKey?: string;
  apiKeys?: Partial<Record<AiProviderId, string>>;
  geminiApiKey?: string;
  customBaseUrl?: string;
  customContextPrompt?: string;
  // Separate or Dual Image Generation Model configuration
  imageApiKey?: string;
  imageGenMode?: ImageGenModeId;
  reasoningEffort?: AiReasoningEffort;
}

function detectProviderFromKey(key: string): AiProviderId {
  const k = key.trim();
  if (k.startsWith('AIza')) return 'gemini';
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('xai-')) return 'xai';
  if (k.startsWith('sk-proj-') || k.startsWith('sk-svcacct-')) return 'openai';
  // DeepSeek keys are typically sk-<32 hex chars>
  if (/^sk-[0-9a-f]{28,40}$/i.test(k)) return 'deepseek';
  if (k.startsWith('sk-')) return 'deepseek';
  return 'deepseek';
}

function resolveActiveProviderAndKey(body: AiEditRequestBody): Array<{
  provider: Exclude<AiProviderId, 'auto' | 'local'>;
  key: string;
  model: string;
  baseUrl?: string;
}> {
  const keys = body.apiKeys || {};
  const explicitKey = (body.apiKey || body.geminiApiKey || '').trim();
  const requestedProvider = body.provider || 'auto';

  const envKeys: Partial<Record<Exclude<AiProviderId, 'auto' | 'local'>, string>> = {
    deepseek: process.env.DEEPSEEK_API_KEY?.trim(),
    openai: process.env.OPENAI_API_KEY?.trim(),
    gemini: process.env.GEMINI_API_KEY?.trim(),
    anthropic: process.env.ANTHROPIC_API_KEY?.trim(),
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    groq: process.env.GROQ_API_KEY?.trim(),
    xai: process.env.XAI_API_KEY?.trim(),
    mistral: process.env.MISTRAL_API_KEY?.trim(),
  };

  if (requestedProvider === 'local') {
    return [];
  }

  if (requestedProvider !== 'auto') {
    const def = AI_PROVIDER_CATALOG.find((p) => p.id === requestedProvider);
    const chosenModel =
      body.model && body.model !== 'auto'
        ? body.model
        : def?.defaultModel || 'deepseek-chat';
    const key =
      (keys[requestedProvider] || explicitKey || envKeys[requestedProvider] || '').trim();

    if (requestedProvider === 'custom') {
      return [
        {
          provider: 'custom',
          key,
          model: chosenModel,
          baseUrl:
            body.customBaseUrl?.trim() ||
            'http://localhost:11434/v1/chat/completions',
        },
      ];
    }

    if (key) {
      // If user pasted an sk-... key under DeepSeek or OpenAI, also add the other as fallback if needed
      const candidates: Array<{
        provider: Exclude<AiProviderId, 'auto' | 'local'>;
        key: string;
        model: string;
        baseUrl?: string;
      }> = [
        {
          provider: requestedProvider,
          key,
          model: chosenModel,
          baseUrl: def?.baseUrl,
        },
      ];
      if (
        requestedProvider === 'deepseek' &&
        key.startsWith('sk-') &&
        !/^sk-[0-9a-f]{28,40}$/i.test(key)
      ) {
        candidates.push({
          provider: 'openai',
          key,
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1/chat/completions',
        });
      } else if (requestedProvider === 'openai' && /^sk-[0-9a-f]{28,40}$/i.test(key)) {
        candidates.push({
          provider: 'deepseek',
          key,
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/chat/completions',
        });
      }
      return candidates;
    }
  }

  // Auto mode: inspect any available keys in priority order
  const candidates: Array<{
    provider: Exclude<AiProviderId, 'auto' | 'local'>;
    key: string;
    model: string;
    baseUrl?: string;
  }> = [];

  const autoKey = (keys.auto || explicitKey || '').trim();
  const isHighEffort = body.reasoningEffort === 'high';
  if (autoKey) {
    const detected = detectProviderFromKey(autoKey);
    if (detected !== 'auto' && detected !== 'local') {
      const def = AI_PROVIDER_CATALOG.find((p) => p.id === detected);
      const primaryModel = isHighEffort
        ? detected === 'deepseek'
          ? 'deepseek-reasoner'
          : detected === 'openai'
          ? 'gpt-4o'
          : detected === 'gemini'
          ? 'gemini-2.5-pro'
          : detected === 'openrouter'
          ? 'deepseek/deepseek-r1'
          : def?.defaultModel || 'deepseek-chat'
        : def?.defaultModel || 'deepseek-chat';
      candidates.push({
        provider: detected,
        key: autoKey,
        model: primaryModel,
        baseUrl: def?.baseUrl,
      });
      // If high effort upgraded the model (e.g. R1 or Pro), also keep the fast default model as immediate fallback
      if (isHighEffort && def?.defaultModel && primaryModel !== def.defaultModel) {
        candidates.push({
          provider: detected,
          key: autoKey,
          model: def.defaultModel,
          baseUrl: def?.baseUrl,
        });
      }
      // Only try OpenAI fallback if it's not a 32-hex DeepSeek key
      if (detected === 'deepseek' && !/^sk-[0-9a-f]{28,40}$/i.test(autoKey)) {
        candidates.push({
          provider: 'openai',
          key: autoKey,
          model: isHighEffort ? 'gpt-4o' : 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1/chat/completions',
        });
      } else if (detected === 'openai') {
        candidates.push({
          provider: 'deepseek',
          key: autoKey,
          model: isHighEffort ? 'deepseek-reasoner' : 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com/chat/completions',
        });
      }
    }
  }

  const providerOrder: Array<Exclude<AiProviderId, 'auto' | 'local' | 'custom'>> = [
    'deepseek',
    'gemini',
    'openai',
    'anthropic',
    'openrouter',
    'groq',
    'xai',
    'mistral',
  ];

  for (const pid of providerOrder) {
    const k = (keys[pid] || envKeys[pid] || '').trim();
    if (k && !candidates.some((c) => c.provider === pid && c.key === k)) {
      const def = AI_PROVIDER_CATALOG.find((p) => p.id === pid);
      candidates.push({
        provider: pid,
        key: k,
        model: def?.defaultModel || 'deepseek-chat',
        baseUrl: def?.baseUrl,
      });
    }
  }

  return candidates;
}

async function callProviderLlm(params: {
  provider: Exclude<AiProviderId, 'auto' | 'local'>;
  key: string;
  model: string;
  baseUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  compositeFrameDataUrl?: string;
  jsonSuffix?: string;
  reasoningEffort?: AiReasoningEffort;
}): Promise<{
  rawText: string;
  providerLabel: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  const {
    provider,
    key,
    model,
    baseUrl,
    systemPrompt,
    userPrompt,
    compositeFrameDataUrl,
    jsonSuffix = 'Return ONLY a valid JSON array of edit objects.',
    reasoningEffort = 'medium',
  } = params;
  const maxOutTokens =
    reasoningEffort === 'high' ? 8192 : reasoningEffort === 'low' ? 2048 : 4096;
  const timeoutMs =
    reasoningEffort === 'high' || model.includes('reasoner') || model.includes('r1')
      ? 90000
      : 45000;
  const effortSuffix =
    reasoningEffort === 'high'
      ? ' • High Effort'
      : reasoningEffort === 'low'
      ? ' • Low Effort'
      : '';
  const fallbackPromptTokens = Math.max(
    24,
    Math.ceil((systemPrompt.length + userPrompt.length) / 4)
  );

  // 1. GOOGLE GEMINI API
  if (provider === 'gemini') {
    const geminiModel = model.startsWith('gemini-') ? model : 'gemini-2.5-flash';
    const parts: Array<Record<string, unknown>> = [
      { text: `${systemPrompt}\n\nUser Prompt: "${userPrompt}"` },
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

    const res = await postJsonRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(key)}`,
      {},
      {
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: reasoningEffort === 'high' ? 0.2 : 0.15,
          maxOutputTokens: maxOutTokens,
        },
      },
      timeoutMs
    );

    if (!res.ok) {
      throw new Error(`Gemini API HTTP ${res.status}: ${res.text.slice(0, 220)}`);
    }

    const data = JSON.parse(res.text);
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const pTok =
      Number(data?.usageMetadata?.promptTokenCount) || fallbackPromptTokens;
    const cTok =
      Number(data?.usageMetadata?.candidatesTokenCount) ||
      Math.max(12, Math.ceil(rawText.length / 4));
    const tTok =
      Number(data?.usageMetadata?.totalTokenCount) || pTok + cTok;
    return {
      rawText,
      providerLabel: `Google Gemini (${geminiModel}${effortSuffix})`,
      usage: { promptTokens: pTok, completionTokens: cTok, totalTokens: tTok },
    };
  }

  // 2. ANTHROPIC CLAUDE API
  if (provider === 'anthropic') {
    const claudeModel = model.startsWith('claude-')
      ? model
      : 'claude-3-7-sonnet-latest';
    const contentBlocks: Array<Record<string, unknown>> = [];

    if (compositeFrameDataUrl && compositeFrameDataUrl.startsWith('data:image/')) {
      const [meta, base64Data] = compositeFrameDataUrl.split(',');
      const mimeMatch = meta.match(/data:(image\/[a-zA-Z0-9+.-]+);base64/);
      if (base64Data) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeMatch ? mimeMatch[1] : 'image/png',
            data: base64Data,
          },
        });
      }
    }
    contentBlocks.push({
      type: 'text',
      text: `User Prompt: "${userPrompt}"\n\n${jsonSuffix}`,
    });

    const res = await postJsonRequest(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      {
        model: claudeModel,
        max_tokens: maxOutTokens,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      },
      timeoutMs
    );

    if (!res.ok) {
      throw new Error(`Anthropic API HTTP ${res.status}: ${res.text.slice(0, 220)}`);
    }

    const data = JSON.parse(res.text);
    const textPart = Array.isArray(data?.content)
      ? data.content.find((b: { type?: string; text?: string }) => b.type === 'text')
      : null;
    const rawText = textPart?.text || '[]';
    const pTok = Number(data?.usage?.input_tokens) || fallbackPromptTokens;
    const cTok =
      Number(data?.usage?.output_tokens) ||
      Math.max(12, Math.ceil(rawText.length / 4));
    return {
      rawText,
      providerLabel: `Anthropic Claude (${claudeModel}${effortSuffix})`,
      usage: {
        promptTokens: pTok,
        completionTokens: cTok,
        totalTokens: pTok + cTok,
      },
    };
  }

  // 3. OPENAI-COMPATIBLE APIs: DEEPSEEK, OPENAI, OPENROUTER, GROQ, XAI GROK, MISTRAL, CUSTOM (OLLAMA/LM STUDIO)
  const endpoint =
    baseUrl ||
    (provider === 'deepseek'
      ? 'https://api.deepseek.com/chat/completions'
      : provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : provider === 'xai'
      ? 'https://api.x.ai/v1/chat/completions'
      : provider === 'mistral'
      ? 'https://api.mistral.ai/v1/chat/completions'
      : 'http://localhost:11434/v1/chat/completions');

  const supportsMultimodalVision =
    (provider === 'openai' && !model.startsWith('o3')) ||
    (provider === 'xai' && model.includes('vision')) ||
    (provider === 'mistral' && model.includes('pixtral')) ||
    (provider === 'groq' && model.includes('vision'));

  const userContent =
    supportsMultimodalVision &&
    compositeFrameDataUrl &&
    compositeFrameDataUrl.startsWith('data:image/')
      ? [
          {
            type: 'text',
            text: `User Prompt: "${userPrompt}"\n\n${jsonSuffix}`,
          },
          {
            type: 'image_url',
            image_url: { url: compositeFrameDataUrl },
          },
        ]
      : `User Prompt: "${userPrompt}"\n\n${jsonSuffix}`;

  const headers: Record<string, string> = {};
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://chromacut.studio';
    headers['X-Title'] = 'ChromaCut AI Video Editor';
  }

  const requestPayload: Record<string, unknown> = {
    model,
    max_tokens: maxOutTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  if (model.startsWith('o3') || model.startsWith('o1')) {
    requestPayload.reasoning_effort = reasoningEffort;
  } else if (provider === 'openrouter' && reasoningEffort === 'high') {
    requestPayload.reasoning = { effort: 'high' };
  }

  // DeepSeek Reasoner (R1) and o3-mini do not accept temperature
  if (!model.includes('reasoner') && !model.startsWith('o3') && !model.startsWith('o1')) {
    requestPayload.temperature = reasoningEffort === 'high' ? 0.2 : 0.15;
  }

  const res = await postJsonRequest(endpoint, headers, requestPayload, timeoutMs);

  if (!res.ok) {
    throw new Error(`${provider.toUpperCase()} API HTTP ${res.status}: ${res.text.slice(0, 220)}`);
  }

  const data = JSON.parse(res.text);
  const rawText = data?.choices?.[0]?.message?.content || '[]';
  const pTok = Number(data?.usage?.prompt_tokens) || fallbackPromptTokens;
  const cTok =
    Number(data?.usage?.completion_tokens) ||
    Math.max(12, Math.ceil(rawText.length / 4));
  const tTok = Number(data?.usage?.total_tokens) || pTok + cTok;

  const friendlyLabels: Record<string, string> = {
    deepseek: `DeepSeek (${model}${effortSuffix})`,
    openai: `OpenAI (${model}${effortSuffix})`,
    openrouter: `OpenRouter (${model}${effortSuffix})`,
    groq: `Groq (${model}${effortSuffix})`,
    xai: `xAI Grok (${model}${effortSuffix})`,
    mistral: `Mistral (${model}${effortSuffix})`,
    custom: `Custom LLM (${model}${effortSuffix})`,
  };

  return {
    rawText,
    providerLabel: friendlyLabels[provider] || `${provider} (${model}${effortSuffix})`,
    usage: {
      promptTokens: pTok,
      completionTokens: cTok,
      totalTokens: tTok,
    },
  };
}

function buildDrawImageSystemPrompt(): string {
  return `You are an expert digital illustrator, concept artist, and HTML5 2D Canvas graphics programmer inside the Sumo VideoEditor studio.
Your job is to draw a rich, detailed, high-definition 1920x1080 widescreen illustration matching the user's prompt by writing synchronous HTML5 2D Canvas JavaScript drawing code (\`renderCode\`) and/or vector SVG (\`svg\`).

Return ONLY a valid JSON object with the following structure:
{
  "title": "Short descriptive title of the image (2-5 words)",
  "renderCode": "/* JavaScript statements using ctx, width, height */"
}

STRICT RULES FOR \`renderCode\`:
1. Available variables in scope: \`ctx\` (CanvasRenderingContext2D), \`width\` (1920), \`height\` (1080), \`Math\`.
2. Do NOT wrap your code in \`function() { ... }\` or markdown fences. Write the JavaScript statements directly as the string value of \`renderCode\`.
3. Paint a complete, multi-layered 1920x1080 scene from back to front:
   - Layer 1 (Background): Fill the entire \`width x height\` canvas using rich \`ctx.createLinearGradient\` / \`ctx.createRadialGradient\`, atmospheric sky/lighting, stars, clouds, sun/moon, or room backdrop.
   - Layer 2 (Environment / Midground): Draw detailed scenery, horizon, mountains, buildings, trees, water reflections, perspective grids, or studio props.
   - Layer 3 (Main Subject): Draw the exact subject(s) requested by the user with expressive geometry (\`beginPath\`, \`bezierCurveTo\`, \`quadraticCurveTo\`, \`arc\`, \`ellipse\`, \`roundRect\`), multi-stop gradients, shading, highlights, shadows (\`ctx.shadowColor\`, \`ctx.shadowBlur\`), and crisp details.
   - Layer 4 (Lighting & Polish): Add atmospheric glow, rim lighting, particles/bokeh, and subtle framing so the final 1920x1080 PNG looks like a polished illustration.
4. Always balance \`ctx.save()\` and \`ctx.restore()\`.
5. Never use external network resources (\`new Image()\`, \`fetch\`), \`document\`, or \`window\`. Everything must render synchronously onto \`ctx\`.`;
}

function buildFallbackProceduralArtwork(prompt: string): {
  title: string;
  renderCode: string;
} {
  const cleanTitle =
    prompt
      .trim()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .slice(0, 4)
      .join(' ') || 'AI Artwork';
  const safeText = JSON.stringify(prompt.trim().slice(0, 64));

  const renderCode = `
ctx.save();
const bg = ctx.createLinearGradient(0, 0, 0, height);
bg.addColorStop(0, '#0f172a');
bg.addColorStop(0.55, '#1e1b4b');
bg.addColorStop(1, '#31102f');
ctx.fillStyle = bg;
ctx.fillRect(0, 0, width, height);

// Glow sun / focal light
const glow = ctx.createRadialGradient(width * 0.5, height * 0.42, 20, width * 0.5, height * 0.42, 420);
glow.addColorStop(0, 'rgba(251, 191, 36, 0.95)');
glow.addColorStop(0.35, 'rgba(244, 63, 94, 0.55)');
glow.addColorStop(1, 'rgba(244, 63, 94, 0)');
ctx.fillStyle = glow;
ctx.beginPath();
ctx.arc(width * 0.5, height * 0.42, 420, 0, Math.PI * 2);
ctx.fill();

// Stars
for (let i = 0; i < 90; i++) {
  const sx = ((i * 197) % 1880) + 20;
  const sy = ((i * 131) % 620) + 20;
  const sr = (i % 3) + 1;
  ctx.fillStyle = i % 4 === 0 ? 'rgba(253, 224, 71, 0.85)' : 'rgba(255, 255, 255, 0.65)';
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
}

// Layered mountains
const drawRidge = (baseY, amp, seed, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 40) {
    const y = baseY - Math.sin(x * 0.0035 + seed) * amp - Math.cos(x * 0.009 - seed) * (amp * 0.45);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
};
drawRidge(height * 0.66, 95, 1.2, '#1e1b4b');
drawRidge(height * 0.74, 75, 2.7, '#111827');
drawRidge(height * 0.83, 48, 4.1, '#090d16');

// Title badge
ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
ctx.font = 'bold 44px sans-serif';
ctx.textAlign = 'center';
ctx.fillText(${safeText}, width * 0.5, height * 0.91);
ctx.restore();
`.trim();

  return { title: cleanTitle, renderCode };
}

function parseDrawImageResponse(
  rawText: string,
  prompt: string
): { title: string; renderCode: string; svg?: string } | null {
  let cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json/gi, '')
    .replace(/```javascript/gi, '')
    .replace(/```js/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(cleaned) as {
      title?: string;
      renderCode?: string;
      code?: string;
      svg?: string;
    };
    const renderCode = (parsed.renderCode || parsed.code || '').trim();
    const svg = typeof parsed.svg === 'string' ? parsed.svg.trim() : undefined;
    if (!renderCode && !svg) return null;

    if (renderCode) {
      // Validate JS syntax before returning to client
      new Function('ctx', 'width', 'height', renderCode);
    }

    const fallbackTitle =
      prompt
        .trim()
        .replace(/[^\w\s-]/g, '')
        .split(/\s+/)
        .slice(0, 4)
        .join(' ') || 'AI Illustration';

    return {
      title: (parsed.title || fallbackTitle).trim(),
      renderCode,
      svg,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AiEditRequestBody;
    const {
      mode = 'edit',
      prompt = '',
      startTime = 0,
      endTime = 5,
      currentTime = 0,
      duration = 12,
      focusedColor = 'all',
      annotations = [],
      allAnnotations = [],
      existingEdits = [],
      splitPoints = [],
      cuts = [],
      mediaFileName = 'Active Media',
      mediaCategory = 'video',
      compositeFrameDataUrl,
      customContextPrompt = '',
      projectSounds = [],
    } = body;

    // 1. CONNECTION TEST MODE (from AI Settings modal)
    if (mode === 'test') {
      const startMs = Date.now();
      if (body.provider === 'local') {
        return NextResponse.json({
          ok: true,
          provider: 'Built-in Semantic Compiler v2',
          model: 'semantic-v2',
          latencyMs: 1,
          message: 'Built-in offline semantic engine is ready (no API key required).',
        });
      }

      const candidates = resolveActiveProviderAndKey(body);
      if (candidates.length === 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'No API key provided. Paste your DeepSeek, Gemini, OpenAI, Claude, OpenRouter, Groq, or xAI key above.',
          },
          { status: 400 }
        );
      }

      const errors: string[] = [];
      for (const cand of candidates) {
        try {
          const testResult = await callProviderLlm({
            provider: cand.provider,
            key: cand.key,
            model: cand.model,
            baseUrl: cand.baseUrl,
            systemPrompt:
              'You are the ChromaCut AI Video Editor compiler. Return ONLY valid JSON: [{"summary":"Test OK","effectType":"zoom","targetColor":"all","params":{"zoomScale":1.5}}]',
            userPrompt: 'Zoom 1.5x test',
          });
          return NextResponse.json({
            ok: true,
            provider: testResult.providerLabel,
            model: cand.model,
            latencyMs: Date.now() - startMs,
            message: `Connected to ${testResult.providerLabel} in ${Date.now() - startMs}ms!`,
          });
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      return NextResponse.json(
        {
          ok: false,
          error: errors.join(' | ') || 'Connection test failed.',
        },
        { status: 400 }
      );
    }

async function tryNativeImageGeneration(params: {
  prompt: string;
  key: string;
  mode: ImageGenModeId;
}): Promise<{
  imageDataUrl: string;
  providerLabel: string;
  title: string;
} | null> {
  const { prompt, key, mode } = params;
  const k = key.trim();
  if (!k || mode === 'code_draw') return null;

  const fallbackTitle =
    prompt
      .trim()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .slice(0, 4)
      .join(' ') || 'AI Generated Image';

  // 1. GOOGLE GEMINI / IMAGEN NATIVE IMAGE GENERATION
  if (mode === 'gemini' || (mode === 'auto' && k.startsWith('AIza'))) {
    // Try Gemini 2.0 Flash Image Generation first
    try {
      const geminiRes = await postJsonRequest(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${encodeURIComponent(
          k
        )}`,
        {},
        {
          contents: [
            {
              parts: [
                {
                  text: `Generate a high-resolution widescreen 16:9 image of: ${prompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }
      );
      if (geminiRes.ok) {
        const data = JSON.parse(geminiRes.text);
        const parts = data?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          const inline = p?.inlineData || p?.inline_data;
          if (inline?.data) {
            const mime = inline.mimeType || inline.mime_type || 'image/png';
            return {
              imageDataUrl: `data:${mime};base64,${inline.data}`,
              providerLabel: 'Google Gemini Image (Native)',
              title: fallbackTitle,
            };
          }
        }
      }
    } catch {
      // Fall through to Imagen 3
    }

    // Try Imagen 3 endpoint
    try {
      const imagenRes = await postJsonRequest(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(
          k
        )}`,
        {},
        {
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '16:9' },
        }
      );
      if (imagenRes.ok) {
        const data = JSON.parse(imagenRes.text);
        const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
        if (b64) {
          return {
            imageDataUrl: `data:image/png;base64,${b64}`,
            providerLabel: 'Google Imagen 3 (Native)',
            title: fallbackTitle,
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  // 2. XAI GROK NATIVE IMAGE GENERATION (grok-2-image-1212)
  if (mode === 'xai' || (mode === 'auto' && k.startsWith('xai-'))) {
    try {
      const xaiRes = await postJsonRequest(
        'https://api.x.ai/v1/images/generations',
        { Authorization: `Bearer ${k}` },
        {
          model: 'grok-2-image-1212',
          prompt,
          response_format: 'b64_json',
        }
      );
      if (xaiRes.ok) {
        const data = JSON.parse(xaiRes.text);
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) {
          return {
            imageDataUrl: `data:image/png;base64,${b64}`,
            providerLabel: 'xAI Grok Image (Native)',
            title: fallbackTitle,
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  // 3. HUGGING FACE FLUX.1-SCHNELL NATIVE IMAGE GENERATION
  if (mode === 'huggingface' || (mode === 'auto' && k.startsWith('hf_'))) {
    try {
      const hfRes = await postJsonRequest(
        'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
        { Authorization: `Bearer ${k}` },
        { inputs: prompt }
      );
      if (hfRes.ok && hfRes.buffer.length > 256) {
        const mime = hfRes.contentType.startsWith('image/')
          ? hfRes.contentType.split(';')[0]
          : 'image/jpeg';
        return {
          imageDataUrl: `data:${mime};base64,${hfRes.buffer.toString('base64')}`,
          providerLabel: 'FLUX.1-schnell (HuggingFace Native)',
          title: fallbackTitle,
        };
      }
    } catch {
      // Fall through
    }
  }

  // 4. STABILITY AI SDXL NATIVE IMAGE GENERATION
  if (mode === 'stability') {
    try {
      const stabRes = await postJsonRequest(
        'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        {
          Authorization: `Bearer ${k}`,
          Accept: 'application/json',
        },
        {
          text_prompts: [{ text: prompt }],
          cfg_scale: 7,
          width: 1344,
          height: 768,
          samples: 1,
          steps: 30,
        }
      );
      if (stabRes.ok) {
        const data = JSON.parse(stabRes.text);
        const b64 = data?.artifacts?.[0]?.base64;
        if (b64) {
          return {
            imageDataUrl: `data:image/png;base64,${b64}`,
            providerLabel: 'Stability AI SDXL (Native)',
            title: fallbackTitle,
          };
        }
      }
    } catch {
      // Fall through
    }
  }

  // 5. OPENAI DALL-E 3 / GPT-IMAGE NATIVE GENERATION (supports separate OpenAI key OR dual OpenAI key)
  if (
    mode === 'openai' ||
    (mode === 'auto' &&
      k.startsWith('sk-') &&
      !k.startsWith('sk-ant-') &&
      !k.startsWith('sk-or-'))
  ) {
    try {
      const oaRes = await postJsonRequest(
        'https://api.openai.com/v1/images/generations',
        { Authorization: `Bearer ${k}` },
        {
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: '1792x1024',
          response_format: 'b64_json',
        }
      );
      if (oaRes.ok) {
        const data = JSON.parse(oaRes.text);
        const b64 = data?.data?.[0]?.b64_json;
        if (b64) {
          return {
            imageDataUrl: `data:image/png;base64,${b64}`,
            providerLabel: 'OpenAI DALL·E 3 (Native)',
            title: fallbackTitle,
          };
        }
      }
    } catch {
      // If key is a DeepSeek sk-... key, OpenAI endpoint will fail and cleanly fall through to DeepSeek Code Draw!
    }
  }

  return null;
}

    // 1.5 AI IMAGE DRAWING MODE (Current Project -> Images -> AI Draw)
    if (mode === 'draw_image') {
      if (!prompt || !prompt.trim()) {
        return NextResponse.json(
          { error: 'Please enter a description of the image to draw.' },
          { status: 400 }
        );
      }

      const drawStartMs = Date.now();
      const separateImgKey = (body.imageApiKey || '').trim();
      const mainKey =
        (body.apiKey || '').trim() ||
        (body.apiKeys?.auto || '').trim() ||
        (body.geminiApiKey || '').trim();
      const effectiveImgKey = separateImgKey || mainKey;
      const imgMode: ImageGenModeId = body.imageGenMode || 'auto';

      // A) Try Native Raster Image Generation Model first (OpenAI DALL-E 3, Gemini Imagen 3, xAI Grok Image, HuggingFace FLUX.1, Stability SDXL)
      // Works in both Separate Image Key mode AND Dual Mode (using the main key if blank)
      if (effectiveImgKey && imgMode !== 'code_draw') {
        const nativeRes = await tryNativeImageGeneration({
          prompt: prompt.trim(),
          key: effectiveImgKey,
          mode: imgMode,
        });
        if (nativeRes) {
          return NextResponse.json({
            ok: true,
            title: nativeRes.title,
            imageDataUrl: nativeRes.imageDataUrl,
            provider: nativeRes.providerLabel,
            usage: {
              promptTokens: 32,
              completionTokens: 256,
              totalTokens: 288,
              latencyMs: Math.max(1, Date.now() - drawStartMs),
            },
          });
        }
      }

      // B) Fallback or Explicit AI Code Draw Mode (DeepSeek, Claude, OpenRouter, or Dual LLM Canvas 1080p Drawing)
      const baseCandidates = resolveActiveProviderAndKey(body);
      const separateCandidates = separateImgKey
        ? resolveActiveProviderAndKey({
            ...body,
            provider: 'auto',
            model: 'auto',
            apiKey: separateImgKey,
            apiKeys: { auto: separateImgKey },
          })
        : [];
      const candidates = [...separateCandidates, ...baseCandidates];
      const drawSystemPrompt = buildDrawImageSystemPrompt();

      for (const cand of candidates) {
        try {
          const { rawText, providerLabel, usage } = await callProviderLlm({
            provider: cand.provider,
            key: cand.key,
            model: cand.model,
            baseUrl: cand.baseUrl,
            systemPrompt: drawSystemPrompt,
            userPrompt: `Draw a detailed 1920x1080 illustration of: ${prompt.trim()}`,
            jsonSuffix:
              'Return ONLY a valid JSON object: {"title": "...", "renderCode": "..."}',
            reasoningEffort: body.reasoningEffort,
          });

          const parsedArt = parseDrawImageResponse(rawText, prompt);
          if (parsedArt) {
            return NextResponse.json({
              ok: true,
              title: parsedArt.title,
              renderCode: parsedArt.renderCode,
              svg: parsedArt.svg,
              provider: providerLabel,
              usage: {
                ...usage,
                latencyMs: Date.now() - drawStartMs,
              },
            });
          }
        } catch (drawErr) {
          console.warn(
            `AI Draw provider ${cand.provider} (${cand.model}) failed, trying next:`,
            drawErr
          );
        }
      }

      const fallbackArt = buildFallbackProceduralArtwork(prompt);
      return NextResponse.json({
        ok: true,
        title: fallbackArt.title,
        renderCode: fallbackArt.renderCode,
        provider: 'Built-in Procedural Artist',
        usage: {
          promptTokens: 24,
          completionTokens: 120,
          totalTokens: 144,
          latencyMs: Math.max(1, Date.now() - drawStartMs),
        },
      });
    }

    // 2. NORMAL AI EDIT COMPILATION MODE
    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const ctxInput: AiEditorContextInput = {
      prompt: prompt.trim(),
      startTime,
      endTime,
      currentTime,
      duration,
      focusedColor,
      annotations,
      allAnnotations: allAnnotations.length > 0 ? allAnnotations : annotations,
      existingEdits,
      splitPoints,
      cuts,
      mediaFileName,
      mediaCategory,
      customContextPrompt,
      reasoningEffort: body.reasoningEffort || 'medium',
      projectSounds,
    };

    const candidates = resolveActiveProviderAndKey(body);
    const systemPrompt = buildAiEditorSystemPrompt(ctxInput);
    const editStartMs = Date.now();

    for (const cand of candidates) {
      try {
        const { rawText, providerLabel, usage } = await callProviderLlm({
          provider: cand.provider,
          key: cand.key,
          model: cand.model,
          baseUrl: cand.baseUrl,
          systemPrompt,
          userPrompt: prompt.trim(),
          compositeFrameDataUrl,
          reasoningEffort: body.reasoningEffort || 'medium',
        });

        const parsed = parseAiEditResponse(rawText, ctxInput, providerLabel);
        if (
          parsed.edits.length > 0 ||
          parsed.cutsToAdd.length > 0 ||
          parsed.splitsToAdd.length > 0 ||
          parsed.newDuration
        ) {
          const editsWithTokens = parsed.edits.map((ed) => ({
            ...ed,
            tokensUsed: usage.totalTokens,
          }));
          return NextResponse.json({
            edits: editsWithTokens,
            cutsToAdd: parsed.cutsToAdd,
            splitsToAdd: parsed.splitsToAdd,
            newDuration: parsed.newDuration,
            provider: providerLabel,
            usage: {
              ...usage,
              latencyMs: Date.now() - editStartMs,
            },
          });
        }
      } catch (cloudErr) {
        console.warn(
          `AI provider ${cand.provider} (${cand.model}) failed, trying next or local compiler:`,
          cloudErr
        );
      }
    }

    // 3. LOCAL SEMANTIC COMPILER (Zero-Latency Fallback + Full Cut/Split/512-Color Support)
    const lowerPrompt = prompt.trim().toLowerCase();
    const localCuts: Array<{ startTime: number; endTime: number }> = [];
    const localSplits: number[] = [];
    const localPromptTokens = Math.max(12, Math.ceil(prompt.trim().length / 3.5));
    const localCompletionTokens = 38;
    const localUsage = {
      promptTokens: localPromptTokens,
      completionTokens: localCompletionTokens,
      totalTokens: localPromptTokens + localCompletionTokens,
      latencyMs: Math.max(1, Date.now() - editStartMs),
    };

    if (/\b(cut|delete|trim|remove\s+segment|snip)\b/i.test(lowerPrompt)) {
      const rangeMatch = lowerPrompt.match(
        /(?:from\s+|between\s+)?(\d+(?:\.\d+)?)\s*s?\s*(?:to|and|-|–)\s*(\d+(?:\.\d+)?)\s*s?/i
      );
      if (rangeMatch) {
        const s = parseFloat(rangeMatch[1]);
        const e = parseFloat(rangeMatch[2]);
        if (!Number.isNaN(s) && !Number.isNaN(e) && Math.abs(e - s) >= 0.1) {
          localCuts.push({ startTime: Math.min(s, e), endTime: Math.max(s, e) });
        }
      } else if (/\b(split|cut\s+here|cut\s+at)\b/i.test(lowerPrompt)) {
        const ptMatch = lowerPrompt.match(/(\d+(?:\.\d+)?)\s*s?/);
        localSplits.push(ptMatch ? parseFloat(ptMatch[1]) : currentTime);
      } else {
        localCuts.push({ startTime, endTime });
      }

      if (localCuts.length > 0 || localSplits.length > 0) {
        return NextResponse.json({
          edits: [],
          cutsToAdd: localCuts,
          splitsToAdd: localSplits,
          provider: 'Built-in Semantic Compiler',
          usage: localUsage,
        });
      }
    }

    const effectiveAnnotations =
      allAnnotations.length > 0 ? allAnnotations : annotations;
    const edits = compilePromptLocally(
      prompt,
      startTime,
      endTime,
      effectiveAnnotations,
      'Built-in Semantic Compiler',
      focusedColor
    ).map((ed) => {
      let nextEnd = ed.endTime;
      const nextParams = { ...ed.params };

      if (
        projectSounds.length > 0 &&
        /\b(sound|audio|play|recorded)\b/i.test(lowerPrompt)
      ) {
        let matched = projectSounds.find((s) => {
          const baseName = s.name.toLowerCase().replace(/\.[a-z0-9]+$/i, '').trim();
          return baseName.length > 0 && lowerPrompt.includes(baseName);
        });
        if (!matched && projectSounds.length === 1) {
          matched = projectSounds[0];
        }
        if (matched) {
          nextParams.audioAssetId = matched.id;
          nextParams.audioAssetName = matched.name;
          const askedForVisualToo =
            /\b(bounce|bouncing|jump|hop|wobble|wave|pulse|vibrate|effect|animate|animation|move|moving|slide|flip|scale|stretch|squash|draw|zoom|blur|glow|text|spin|rotate|color|pixelate|spotlight|shake|flash|fire|flame|water|rain|snow|spark|particle|screen|frame|box|circle|arrow)\b/i.test(
              lowerPrompt
            );
          if (!askedForVisualToo) {
            delete nextParams.renderCode;
            delete nextParams.customSvg;
            delete nextParams.svg;
          }
          if (typeof matched.durationSec === 'number' && matched.durationSec > 0) {
            const soundEnd = Number((ed.startTime + matched.durationSec).toFixed(2));
            if (
              soundEnd > nextEnd ||
              /\b(increase|extend|lengthen|length|longer|fit|full\s+sound|if\s+needed)\b/i.test(
                lowerPrompt
              )
            ) {
              nextEnd = Math.max(nextEnd, soundEnd);
            }
          }
        }
      }

      return {
        ...ed,
        endTime: nextEnd,
        params: nextParams,
        summary: nextParams.audioAssetName
          ? `Play "${nextParams.audioAssetName}"`
          : ed.summary,
        tokensUsed: localUsage.totalTokens,
      };
    });

    return NextResponse.json({
      edits,
      cutsToAdd: [],
      splitsToAdd: [],
      provider: 'Built-in Semantic Compiler',
      usage: localUsage,
    });
  } catch (err) {
    console.error('Error in /api/ai-edit:', err);
    return NextResponse.json(
      { error: 'Failed to compile AI video edit' },
      { status: 500 }
    );
  }
}
