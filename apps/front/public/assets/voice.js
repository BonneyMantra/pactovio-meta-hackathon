// Microphone capture → 16 kHz mono 16-bit PCM WAV, in the browser, for POST /api/voice/transcribe.

export function canRecord() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && (window.OfflineAudioContext || window.webkitOfflineAudioContext));
}

/** Starts recording; resolves to { stop(): Promise<Blob wav>, cancel() }. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.start(250);
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        release();
        try { resolve(await toWav16k(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))); } catch (e) { reject(e); }
      };
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch { /* already stopped */ } release(); },
  };
}

async function toWav16k(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  let decoded;
  try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { ctx.close?.(); }
  const rate = 16000, length = Math.max(1, Math.ceil(decoded.duration * rate));
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new Off(1, length, rate);
  const src = off.createBufferSource();
  src.buffer = decoded; // multi-channel input is down-mixed to the single output channel
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  return encodeWav(pcm, rate);
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
