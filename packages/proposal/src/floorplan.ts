import { z } from 'zod';
import { bytesToB64, segment, type ChatMessage, type SamDetection } from '@pactovio/models';
import { assetKey, putAsset } from './assets';
import { addUsage, ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

export interface FloorplanResult { image_ref: string; placements: NonNullable<Proposal['floorplan']>['placements']; candidates: number; sam_calls: number; objects?: { id: string; what: string; box: number[] }[] }

/**
 * On CAD drawings SAM 3.1 finds colour/shape primitives, not room semantics ("ATM", "door" return nothing on a plan), so it is
 * asked for the primitives architectural drawings are drawn with and the vision model names each box. Ordered by usefulness.
 */
export const SAM_CONCEPTS = ['dark blue rectangle', 'dark red square', 'brown line', 'orange rectangle', 'red circle', 'yellow rectangle', 'light blue strip', 'gray rectangle', 'brown rectangle', 'green rectangle'] as const;
const DEVICE_W = 0.026, DEVICE_H = 0.036;

export interface Candidate { id: string; box: [number, number, number, number]; concept: string }

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

const clamp = (v: number): number => Math.min(1, Math.max(0, Number(v.toFixed(4))));
type Where = 'on' | 'above' | 'below' | 'left' | 'right';
/** Device box placed relative to its anchor box. */
export function placeRelative(anchor: [number, number, number, number], where: Where): [number, number, number, number] {
  const [ax, ay, aw, ah] = anchor; const cx = ax + aw / 2, cy = ay + ah / 2;
  const [x, y] = where === 'on' ? [cx - DEVICE_W / 2, cy - DEVICE_H / 2] : where === 'above' ? [cx - DEVICE_W / 2, ay - DEVICE_H - 0.004]
    : where === 'below' ? [cx - DEVICE_W / 2, ay + ah + 0.004] : where === 'left' ? [ax - DEVICE_W - 0.004, cy - DEVICE_H / 2] : [ax + aw + 0.004, cy - DEVICE_H / 2];
  return [clamp(Math.min(x, 1 - DEVICE_W)), clamp(Math.min(y, 1 - DEVICE_H)), DEVICE_W, DEVICE_H];
}

const PlaceModel = z.object({
  /** What each SAM box is on the drawing ("ATM 1", "strong-room door", "legend swatch"). */
  anchors: z.array(z.object({ id: z.string(), what: z.string() })),
  placements: z.array(z.object({
    device_sku: z.string(), label: z.string(),
    anchor_id: z.string().nullable(), where: z.enum(['on', 'above', 'below', 'left', 'right']),
    /** Only when no SAM box fits: estimated [x, y] centre, 0..1. */
    approx_xy: z.tuple([z.number(), z.number()]).nullable(),
  })),
});

const SYSTEM = `You place security devices on a branch floor plan. The image is the drawing; SAM 3.1 segmented shapes on it and returned boxes, listed as id: [x, y, w, h] normalised 0..1 (origin top-left) with pixel centres.
First, in "anchors", name what every box is by looking at the drawing at that location (ATM 1, strong-room safe, strong-room door, back door, window, cash counter 2, UPS, server rack, existing CCTV dome, seat...). Boxes inside the legend, title block or scale bar are "legend" and must not be used as anchors.
Then place each device from the kit next to the real object it protects (aim for 8-16 placements covering the strong room, ATM lobby, entrances, windows, teller area and server room):
- door contacts on doors, glass-break detectors by windows, vibration sensor on each ATM, PIR in rooms and lobbies, panic button at cash counters, OTP keypad at the strong-room door, panel in the server/UPS room.
- the zone panel / communicator in the server/UPS room, shutter sensor at the main rolling shutter, hooter/strobe near the entrance, ATM analytics and 2-way audio in the ATM lobby.
Use anchor_id with a "where" offset when a listed box is the right object; otherwise anchor_id null with approx_xy (your own estimate). One placement per device instance on this drawing; label it with the device and the place ("Vibration sensor - ATM 1"). Only use skus from the kit.`;

export const planFloor = (ctx: RunCtx): Promise<string> => runStep(ctx, 'floor_plan', () => !!ctx.state.floorplan, async () => {
  const { rfq, bom } = ctx.state;
  if (!rfq || !bom) throw new Error('compose_bom must run before floor_plan');
  const file = rfq.floorplan_file ? ctx.files.find((f) => f.filename === rfq.floorplan_file) : undefined;
  if (!file) { ctx.state.floorplan = { skipped: 'No floor-plan image in the RFQ' }; return 'skipped: no floor-plan image'; }
  const mime = file.mime.startsWith('image/') ? file.mime : /\.jpe?g$/i.test(file.filename) ? 'image/jpeg' : 'image/png';
  const ref = assetKey(ctx.workspaceId, ctx.proposalId, `floorplan${/\.jpe?g$/i.test(file.filename) ? '.jpg' : '.png'}`);
  await putAsset(ctx.env, ref, file.bytes, mime);

  const t0 = Date.now();
  const found = (await Promise.all(SAM_CONCEPTS.map((concept) => segment(ctx.env, { concept, image: { bytes: file.bytes, mime }, fetchImpl: ctx.fetchImpl })
    .then((r) => { addUsage(ctx, { model: r.model, costUsd: r.costUsd, ms: 0 }); return { concept, detections: r.detections }; })
    .catch(() => ({ concept, detections: [] as SamDetection[] })))));
  addUsage(ctx, { model: 'meta:sam-3.1', costUsd: 0, ms: Date.now() - t0 });
  const cands = mergeCandidates(found);
  if (!cands.length) throw new Error('SAM 3.1 found no objects on the drawing');
  const px = (c: Candidate) => `(${Math.round((c.box[0] + c.box[2] / 2) * 1000) / 10}%, ${Math.round((c.box[1] + c.box[3] / 2) * 1000) / 10}%)`;
  const kit = [...bom.per_branch_items, ...bom.per_site_items];
  const names = new Map(bom.scope_of_supply.map((s) => [s.sku, s.description.slice(0, 70)]));
  const user = [
    { type: 'text', text: `SAM boxes:\n${cands.map((c) => `${c.id}: [${c.box.join(', ')}] centre ${px(c)} (${c.concept})`).join('\n')}\n\nDevice kit (sku: qty per site):\n${kit.map((k) => `${k.sku} x${k.qty} - ${names.get(k.sku) ?? ''}`).join('\n')}` },
    { type: 'image_url', image_url: { url: `data:${mime};base64,${bytesToB64(file.bytes)}` } },
  ];
  const out = await ask(ctx, PlaceModel, { purpose: 'Place devices on floor plan (SAM anchors)', role: 'vision', timeoutMs: 150_000, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] as unknown as ChatMessage[], maxTokens: 4500, name: 'placements' });

  const what = new Map(out.anchors.map((a) => [a.id, a.what]));
  const byId = new Map(cands.filter((c) => !/legend|title|scale/i.test(what.get(c.id) ?? '')).map((c) => [c.id, c]));
  const skus = new Set(kit.map((k) => k.sku));
  const placements: FloorplanResult['placements'] = [];
  for (const p of out.placements) {
    if (!skus.has(p.device_sku)) continue;
    const a = p.anchor_id ? byId.get(p.anchor_id) : undefined;
    if (a) placements.push({ device_sku: p.device_sku, label: p.label, box: placeRelative(a.box, p.where), source: 'sam-3.1', anchor: what.get(a.id) ?? a.id });
    else if (p.approx_xy) placements.push({ device_sku: p.device_sku, label: p.label, box: [clamp(p.approx_xy[0] - DEVICE_W / 2), clamp(p.approx_xy[1] - DEVICE_H / 2), DEVICE_W, DEVICE_H], source: 'spark-vision' });
  }
  const objects = [...byId.values()].map((c) => ({ id: c.id, what: what.get(c.id) ?? c.concept, box: c.box }));
  ctx.state.floorplan = { image_ref: ref, placements, candidates: cands.length, sam_calls: SAM_CONCEPTS.length, objects };
  return `${placements.filter((p) => p.source === 'sam-3.1').length} SAM-anchored + ${placements.filter((p) => p.source !== 'sam-3.1').length} estimated placements from ${cands.length} SAM boxes`;
});
