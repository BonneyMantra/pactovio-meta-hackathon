import { z } from 'zod';
import { bytesToB64, segment, type ChatMessage, type SamDetection } from '@pactovio/models';
import { addUsage, ask, type RunCtx } from './ctx';
import type { Placement } from './schema';

/** Shared SAM 3.1 + vision placement: SAM segments objects on an image, the vision model names each box and anchors devices to them. */
const DEVICE_W = 0.026, DEVICE_H = 0.036;
type Box = [number, number, number, number];
export interface Candidate { id: string; box: Box; concept: string }
export interface SceneObject { id: string; what: string; box: number[] }
export interface PlaceResult { placements: z.infer<typeof Placement>[]; objects: SceneObject[]; candidates: number; sam_calls: number }

const iou = (a: number[], b: number[]): number => {
  const x = Math.max(0, Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - Math.max(a[0]!, b[0]!));
  const y = Math.max(0, Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!));
  const inter = x * y;
  return inter / (a[2]! * a[3]! + b[2]! * b[3]! - inter || 1);
};

/** Merge detections from several concept queries, dropping near-duplicates (IoU > 0.7) and tiny specks; ids A1..An, stable top-to-bottom. */
export function mergeCandidates(byConcept: { concept: string; detections: SamDetection[] }[], cap = 64): Candidate[] {
  const all: Omit<Candidate, 'id'>[] = [];
  for (const { concept, detections } of byConcept) for (const d of detections) {
    if (d.box[2] * d.box[3] < 0.0002 || d.box[2] * d.box[3] > 0.5) continue;
    if (all.some((a) => iou(a.box, d.box) > 0.7)) continue;
    all.push({ box: d.box, concept });
  }
  return all.slice(0, cap).sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]).map((c, i) => ({ ...c, id: `A${i + 1}` }));
}

export const clamp = (v: number): number => Math.min(1, Math.max(0, Number(v.toFixed(4))));
type Where = 'on' | 'above' | 'below' | 'left' | 'right';
/** Device box placed relative to its anchor box. */
export function placeRelative(anchor: Box, where: Where): Box {
  const [ax, ay, aw, ah] = anchor; const cx = ax + aw / 2, cy = ay + ah / 2;
  const [x, y] = where === 'on' ? [cx - DEVICE_W / 2, cy - DEVICE_H / 2] : where === 'above' ? [cx - DEVICE_W / 2, ay - DEVICE_H - 0.004]
    : where === 'below' ? [cx - DEVICE_W / 2, ay + ah + 0.004] : where === 'left' ? [ax - DEVICE_W - 0.004, cy - DEVICE_H / 2] : [ax + aw + 0.004, cy - DEVICE_H / 2];
  return [clamp(Math.min(x, 1 - DEVICE_W)), clamp(Math.min(y, 1 - DEVICE_H)), DEVICE_W, DEVICE_H];
}

const PlaceModel = z.object({
  /** What each SAM box is on the image ("ATM 1", "strong-room door", "legend swatch"). */
  anchors: z.array(z.object({ id: z.string(), what: z.string() })),
  placements: z.array(z.object({
    device_sku: z.string(), label: z.string(),
    anchor_id: z.string().nullable(), where: z.enum(['on', 'above', 'below', 'left', 'right']),
    /** Only when no SAM box fits: estimated [x, y] centre, 0..1. */
    approx_xy: z.tuple([z.number(), z.number()]).nullable(),
  })),
});

export interface PlaceInput {
  image: { bytes: Uint8Array; mime: string };
  concepts: readonly string[];
  kit: { sku: string; qty: number }[];
  names: Map<string, string>;
  system: string;
  purpose: string;
  /** Box names the model gives to non-objects (legend, title block) that must never anchor a device. */
  ignore?: RegExp;
}

export async function placeOnImage(ctx: RunCtx, i: PlaceInput): Promise<PlaceResult> {
  const t0 = Date.now();
  const found = await Promise.all(i.concepts.map((concept) => segment(ctx.env, { concept, image: i.image, fetchImpl: ctx.fetchImpl })
    .then((r) => { addUsage(ctx, { model: r.model, costUsd: r.costUsd, ms: 0 }); return { concept, detections: r.detections }; })
    .catch(() => ({ concept, detections: [] as SamDetection[] }))));
  addUsage(ctx, { model: 'meta:sam-3.1', costUsd: 0, ms: Date.now() - t0 });
  const cands = mergeCandidates(found);
  if (!cands.length) throw new Error('SAM 3.1 found no objects on the image');
  const pc = (c: Candidate) => `(${Math.round((c.box[0] + c.box[2] / 2) * 1000) / 10}%, ${Math.round((c.box[1] + c.box[3] / 2) * 1000) / 10}%)`;
  const user = [
    { type: 'text', text: `SAM boxes:\n${cands.map((c) => `${c.id}: [${c.box.join(', ')}] centre ${pc(c)} (${c.concept})`).join('\n')}\n\nDevice kit (sku: qty per site):\n${i.kit.map((k) => `${k.sku} x${k.qty} - ${i.names.get(k.sku) ?? ''}`).join('\n')}` },
    { type: 'image_url', image_url: { url: `data:${i.image.mime};base64,${bytesToB64(i.image.bytes)}` } },
  ];
  const out = await ask(ctx, PlaceModel, { purpose: i.purpose, role: 'vision', timeoutMs: 150_000, messages: [{ role: 'system', content: i.system }, { role: 'user', content: user }] as unknown as ChatMessage[], maxTokens: 4500, name: 'placements' });

  const what = new Map(out.anchors.map((a) => [a.id, a.what]));
  const ignore = i.ignore ?? /legend|title|scale/i;
  const byId = new Map(cands.filter((c) => !ignore.test(what.get(c.id) ?? '')).map((c) => [c.id, c]));
  const skus = new Set(i.kit.map((k) => k.sku));
  const placements: PlaceResult['placements'] = [];
  for (const p of out.placements) {
    if (!skus.has(p.device_sku)) continue;
    const a = p.anchor_id ? byId.get(p.anchor_id) : undefined;
    if (a) placements.push({ device_sku: p.device_sku, label: p.label, box: placeRelative(a.box, p.where), source: 'sam-3.1', anchor: what.get(a.id) ?? a.id });
    else if (p.approx_xy) placements.push({ device_sku: p.device_sku, label: p.label, box: [clamp(p.approx_xy[0] - DEVICE_W / 2), clamp(p.approx_xy[1] - DEVICE_H / 2), DEVICE_W, DEVICE_H], source: 'spark-vision' });
  }
  const objects = [...byId.values()].map((c) => ({ id: c.id, what: what.get(c.id) ?? c.concept, box: c.box }));
  return { placements, objects, candidates: cands.length, sam_calls: i.concepts.length };
}

export const summarise = (r: PlaceResult): string =>
  `${r.placements.filter((p) => p.source === 'sam-3.1').length} SAM-anchored + ${r.placements.filter((p) => p.source !== 'sam-3.1').length} estimated placements from ${r.candidates} SAM boxes`;
