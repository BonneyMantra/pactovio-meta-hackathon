import { bytesToB64, metaFetch, metered, type MetaEnv } from './meta-http';

/** SAM 3.1 list price: $2.50 per 1,000 images. */
export const SAM_MODEL = 'sam-3.1';
export const SAM_USD_PER_IMAGE = 0.0025;

export interface SamDetection {
  /** Stable object id within the response (not dense). */
  id: number;
  frame: number;
  /** Corner box in source pixels (x2/y2 inclusive). */
  px: { x1: number; y1: number; x2: number; y2: number };
  /** Source image size. */
  size: { w: number; h: number };
  /** Normalised [x, y, w, h], each 0..1 of the source image. */
  box: [number, number, number, number];
  confidence?: number;
  /** Mask raster header only; the base85 payload is not retained (boxes are what placement needs). */
  mask?: { h: number; w: number; enc: string };
}

const RECORD = /(?:^|,)(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>(?:<\|mask;x=0;y=0(?:;c=[\d.]+)?;data=(\d+),(\d+),(.).*?\|>)?/g;

/**
 * Parse SAM's special-token text (one line per frame: `<Nf>id<|box;...|><|mask;...|>,id...`) into normalised boxes.
 * Empty text is a valid "no matches" result. Mask payloads are skipped without decoding.
 */
export function parseSamOutput(text: string): SamDetection[] {
  const out: SamDetection[] = [];
  for (const line of text.split('\n')) {
    const fm = /^\s*<(\d+)f>/.exec(line);
    if (!fm) continue;
    const frame = Number(fm[1]);
    const body = line.slice(fm[0].length);
    for (const m of body.matchAll(RECORD)) {
      const [x1, y1, x2, y2, w, h] = [m[2], m[3], m[4], m[5], m[6], m[7]].map(Number) as [number, number, number, number, number, number];
      if (!w || !h) continue;
      const clamp = (v: number) => Math.min(1, Math.max(0, Number(v.toFixed(4))));
      out.push({
        id: Number(m[1]), frame, px: { x1, y1, x2, y2 }, size: { w, h },
        box: [clamp(x1 / w), clamp(y1 / h), clamp((x2 - x1 + 1) / w), clamp((y2 - y1 + 1) / h)],
        ...(m[8] !== undefined ? { confidence: Number(m[8]) } : {}),
        ...(m[9] ? { mask: { h: Number(m[9]), w: Number(m[10]), enc: m[11]! } } : {}),
      });
    }
  }
  return out;
}

/** Collect `response.output_text.delta` payloads from an SSE body; each delta is one frame line. */
export function sseTextDeltas(sse: string): string {
  const lines: string[] = [];
  for (const raw of sse.split('\n')) {
    if (!raw.startsWith('data:')) continue;
    const data = raw.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const j = JSON.parse(data) as { type?: string; delta?: string };
      if (j.type === 'response.output_text.delta' && typeof j.delta === 'string') lines.push(j.delta);
    } catch { /* partial or non-JSON line */ }
  }
  return lines.join('\n');
}

export interface SegmentInput {
  /** Short noun phrase naming one concept ("emergency exit door"); one concept per call. */
  concept: string;
  image: { bytes: Uint8Array; mime: string } | { url: string };
  fetchImpl?: typeof fetch;
}
export interface SegmentResult { concept: string; detections: SamDetection[]; ms: number; costUsd: number; model: string; raw: string }

export async function segment(env: MetaEnv, i: SegmentInput): Promise<SegmentResult> {
  const t0 = Date.now();
  const imageUrl = 'url' in i.image ? i.image.url : `data:${i.image.mime};base64,${bytesToB64(i.image.bytes)}`;
  const body = {
    model: SAM_MODEL, stream: true,
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: i.concept }, { type: 'input_image', image_url: imageUrl }] }],
  };
  const raw = await metered(env, SAM_USD_PER_IMAGE, async () => {
    const res = await metaFetch(env, { path: '/responses', fetchImpl: i.fetchImpl, init: { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body) } });
    return sseTextDeltas(await res.text());
  });
  return { concept: i.concept, detections: parseSamOutput(raw), ms: Date.now() - t0, costUsd: SAM_USD_PER_IMAGE, model: `meta:${SAM_MODEL}`, raw: raw.replace(/data=(\d+,\d+,.)[^|]*/g, 'data=$1…') };
}
