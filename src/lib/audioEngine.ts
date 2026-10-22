import { BuiltInSceneId, EffectType } from '@/types/editor';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

/**
 * Extracts normalized waveform amplitude peaks [0.08 .. 0.96] from a media File
 * using WebAudio decodeAudioData, falling back to procedural peaks if no audio track exists.
 */
export async function extractAudioPeaksFromFile(
  file: File,
  barCount = 96
): Promise<number[]> {
  try {
    const ctx = getAudioContext();
    if (!ctx) return generateProceduralWaveform('scenic_valley', barCount);
    const buffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buffer);
    const channelData = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channelData.length / barCount));
    const peaks: number[] = [];

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const start = i * blockSize;
      const step = Math.max(1, Math.floor(blockSize / 64));
      let count = 0;
      for (let j = 0; j < blockSize && start + j < channelData.length; j += step) {
        sum += Math.abs(channelData[start + j]);
        count++;
      }
      const avg = count > 0 ? sum / count : 0.1;
      peaks.push(Math.min(0.96, Math.max(0.1, avg * 3.2)));
    }
    return peaks;
  } catch {
    return generateProceduralWaveform('scenic_valley', barCount);
  }
}

/**
 * Generates deterministic, musical waveform envelopes for built-in scenes.
 */
export function generateProceduralWaveform(
  sceneId: BuiltInSceneId,
  barCount = 96
): number[] {
  const seedOffset =
    sceneId === 'scenic_valley' ? 0 : sceneId === 'night_express' ? 2.4 : 5.1;
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const t = i / barCount;
    const wave1 = Math.abs(Math.sin(t * Math.PI * 14 + seedOffset));
    const wave2 = Math.abs(Math.cos(t * Math.PI * 29 + seedOffset * 1.7)) * 0.5;
    const rhythm = (i % 6 === 0 ? 0.25 : 0) + (i % 16 === 0 ? 0.2 : 0);
    const val = Math.min(0.95, Math.max(0.12, (wave1 * 0.55 + wave2 * 0.35 + rhythm) * 0.9));
    peaks.push(Number(val.toFixed(2)));
  }
  return peaks;
}

/**
 * Synthesizes a subtle, studio-grade WebAudio sound effect synced to an AI edit type.
 */
export function playAiEffectSoundCue(effectType: EffectType) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.14, now);
  masterGain.connect(ctx.destination);

  if (effectType === 'zoom') {
    // Cinematic smooth frequency sweep "whoosh"
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.22);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.38);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.8, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.42);
  } else if (effectType === 'halftone_ink' || effectType === 'camera_fx') {
    // Crisp low-end Taiko / Anime impact punch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.28);

    gain.gain.setValueAtTime(1.0, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.32);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.34);
  } else if (effectType === 'generative_replace' || effectType === 'neon_glow') {
    // Dual-harmonic crystalline AI synthesis chime
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = now + idx * 0.045;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.35, start);
      gain.gain.exponentialRampToValueAtTime(0.008, start + 0.35);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + 0.36);
    });
  } else {
    // Subtle warm confirmation pulse for blur / spotlight / callouts
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.16);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }
}
