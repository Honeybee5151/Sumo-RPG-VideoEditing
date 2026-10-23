import { NextRequest, NextResponse } from 'next/server';
import {
  AiEditorContextInput,
  buildAiEditorSystemPrompt,
  parseAiEditResponse,
} from '@/lib/aiContext';
import { compilePromptLocally } from '@/lib/editCompiler';
import {
  AI_PROVIDER_CATALOG,
  AiProviderId,
  EffectType,
  MarkColor,
  ScreenAnnotation,
} from '@/types/editor';

interface AiEditRequestBody {
  mode?: 'edit' | 'test';
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
  // AI Provider configuration
  provider?: AiProviderId;
  model?: string;
  apiKey?: string;
  apiKeys?: Partial<Record<AiProviderId, string>>;
  geminiApiKey?: string;
  customBaseUrl?: string;
  customContextPrompt?: string;
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
      if (requestedProvider === 'deepseek' && key.startsWith('sk-')) {
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
  if (autoKey) {
    const detected = detectProviderFromKey(autoKey);
    if (detected !== 'auto' && detected !== 'local') {
      const def = AI_PROVIDER_CATALOG.find((p) => p.id === detected);
      candidates.push({
        provider: detected,
        key: autoKey,
        model: def?.defaultModel || 'deepseek-chat',
        baseUrl: def?.baseUrl,
      });
      // If key starts with sk- (and isn't sk-ant- or sk-or-), try both DeepSeek and OpenAI automatically
      if (detected === 'deepseek') {
        candidates.push({
          provider: 'openai',
          key: autoKey,
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1/chat/completions',
        });
      } else if (detected === 'openai') {
        candidates.push({
          provider: 'deepseek',
          key: autoKey,
          model: 'deepseek-chat',
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
}): Promise<{ rawText: string; providerLabel: string }> {
  const {
    provider,
    key,
    model,
    baseUrl,
    systemPrompt,
    userPrompt,
    compositeFrameDataUrl,
  } = params;

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

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        geminiModel
      )}:generateContent?key=${encodeURIComponent(key)}`,
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

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 220)}`);
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    return {
      rawText,
      providerLabel: `Google Gemini (${geminiModel})`,
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
      text: `User Prompt: "${userPrompt}"\n\nReturn ONLY a valid JSON array of edit objects.`,
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: claudeModel,
        max_tokens: 1500,
        temperature: 0.15,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API HTTP ${res.status}: ${errText.slice(0, 220)}`);
    }

    const data = await res.json();
    const textPart = Array.isArray(data?.content)
      ? data.content.find((b: { type?: string; text?: string }) => b.type === 'text')
      : null;
    return {
      rawText: textPart?.text || '[]',
      providerLabel: `Anthropic Claude (${claudeModel})`,
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
            text: `User Prompt: "${userPrompt}"\n\nReturn ONLY a valid JSON array of edit objects.`,
          },
          {
            type: 'image_url',
            image_url: { url: compositeFrameDataUrl },
          },
        ]
      : `User Prompt: "${userPrompt}"\n\nReturn ONLY a valid JSON array of edit objects.`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://chromacut.studio';
    headers['X-Title'] = 'ChromaCut AI Video Editor';
  }

  const requestPayload: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };

  // DeepSeek Reasoner (R1) and o3-mini do not accept temperature
  if (!model.includes('reasoner') && !model.startsWith('o3')) {
    requestPayload.temperature = 0.15;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestPayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider.toUpperCase()} API HTTP ${res.status}: ${errText.slice(0, 220)}`);
  }

  const data = await res.json();
  const rawText = data?.choices?.[0]?.message?.content || '[]';

  const friendlyLabels: Record<string, string> = {
    deepseek: `DeepSeek (${model})`,
    openai: `OpenAI (${model})`,
    openrouter: `OpenRouter (${model})`,
    groq: `Groq (${model})`,
    xai: `xAI Grok (${model})`,
    mistral: `Mistral (${model})`,
    custom: `Custom LLM (${model})`,
  };

  return {
    rawText,
    providerLabel: friendlyLabels[provider] || `${provider} (${model})`,
  };
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
    };

    const candidates = resolveActiveProviderAndKey(body);
    const systemPrompt = buildAiEditorSystemPrompt(ctxInput);

    for (const cand of candidates) {
      try {
        const { rawText, providerLabel } = await callProviderLlm({
          provider: cand.provider,
          key: cand.key,
          model: cand.model,
          baseUrl: cand.baseUrl,
          systemPrompt,
          userPrompt: prompt.trim(),
          compositeFrameDataUrl,
        });

        const parsed = parseAiEditResponse(rawText, ctxInput, providerLabel);
        if (
          parsed.edits.length > 0 ||
          parsed.cutsToAdd.length > 0 ||
          parsed.splitsToAdd.length > 0
        ) {
          return NextResponse.json({
            edits: parsed.edits,
            cutsToAdd: parsed.cutsToAdd,
            splitsToAdd: parsed.splitsToAdd,
            provider: providerLabel,
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
    );

    return NextResponse.json({
      edits,
      cutsToAdd: [],
      splitsToAdd: [],
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
