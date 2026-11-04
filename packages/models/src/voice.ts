import { metaFetch, metered, type MetaEnv } from './meta-http';

export const VOICE_MODEL = 'muse-voice-transcribe-1.0';
/** Muse Voice Transcribe list price: $0.18 per hour of audio, metered in whole seconds. */
export const VOICE_USD_PER_SECOND = 0.18 / 3600;
export const MAX_AUDIO_SECONDS = 600;
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

export interface WavInfo { sampleRate: number; channels: number; bits: number; seconds: number }

/** Read a PCM WAV header; throws a client-safe message when the file is not 16/24 kHz mono PCM16 within 10 minutes. */
export function inspectWav(b: Uint8Array): WavInfo {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Audio must be a WAV file');
  let off = 12; let fmt: WavInfo | null = null; let dataBytes = 0;
  while (off + 8 <= b.length) {
    const id = tag(off); const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      if (dv.getUint16(off + 8, true) !== 1) throw new Error('WAV must be uncompressed PCM');
      fmt = { channels: dv.getUint16(off + 10, true), sampleRate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true), seconds: 0 };
    } else if (id === 'data') { dataBytes = Math.min(size, b.length - off - 8); break; }
    off += 8 + size + (size % 2);
  }
  if (!fmt || !dataBytes) throw new Error('WAV has no audio data');
  if (fmt.channels !== 1 || fmt.bits !== 16 || ![16000, 24000].includes(fmt.sampleRate)) throw new Error('WAV must be mono 16-bit PCM at 16 or 24 kHz');
  fmt.seconds = dataBytes / (fmt.sampleRate * 2);
  if (fmt.seconds > MAX_AUDIO_SECONDS) throw new Error('Audio is longer than 10 minutes');
  return fmt;
}

/** Normalise TranscribeResponse: whole-recording text from `transcript`, or the turns joined in order. */
export function transcriptText(j: unknown): string {
  const o = (j ?? {}) as { transcript?: unknown; text?: unknown; turns?: { transcript?: string; text?: string }[] };
  if (typeof o.transcript === 'string') return o.transcript.trim();
  if (typeof o.text === 'string') return o.text.trim();
  return (o.turns ?? []).map((t) => t.transcript ?? t.text ?? '').join(' ').replace(/\s+/g, ' ').trim();
}

export interface TranscribeResult { text: string; seconds: number; ms: number; costUsd: number; model: string; raw: unknown }

export async function transcribe(env: MetaEnv, i: { wav: Uint8Array; languageBias?: string[]; keywords?: string[]; fetchImpl?: typeof fetch }): Promise<TranscribeResult> {
  if (i.wav.length > MAX_AUDIO_BYTES) throw new Error('Audio is larger than 32 MB');
  const info = inspectWav(i.wav);
  const cost = Math.max(VOICE_USD_PER_SECOND, Math.floor(info.seconds) * VOICE_USD_PER_SECOND);
  const t0 = Date.now();
  const form = new FormData();
  form.set('request', new Blob([JSON.stringify({ model: VOICE_MODEL, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', ...(i.languageBias?.length ? { languageBias: i.languageBias } : {}), ...(i.keywords?.length ? { keywords: i.keywords } : {}) })], { type: 'application/json' }));
  form.set('audio', new Blob([i.wav], { type: 'audio/wav' }), 'recording.wav');
  const raw = await metered(env, cost, async () => {
    const res = await metaFetch(env, { path: '/asr/transcribe', fetchImpl: i.fetchImpl, init: { method: 'POST', headers: { accept: 'application/json' }, body: form } });
    return await res.json();
  });
  return { text: transcriptText(raw), seconds: info.seconds, ms: Date.now() - t0, costUsd: cost, model: `meta:${VOICE_MODEL}`, raw };
}
