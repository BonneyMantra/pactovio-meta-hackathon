import { assetKey, putAsset } from './assets';
import { runStep, type RunCtx } from './ctx';
import { placeOnImage, summarise, type SceneObject } from './place';
import type { Proposal } from './schema';

export { mergeCandidates, placeRelative, type Candidate } from './place';
export interface FloorplanResult { image_ref: string; placements: NonNullable<Proposal['floorplan']>['placements']; candidates: number; sam_calls: number; objects?: SceneObject[] }

/**
 * On CAD drawings SAM 3.1 finds colour/shape primitives, not room semantics ("ATM", "door" return nothing on a plan), so it is
 * asked for the primitives architectural drawings are drawn with and the vision model names each box. Ordered by usefulness.
 */
export const SAM_CONCEPTS = ['dark blue rectangle', 'dark red square', 'brown line', 'orange rectangle', 'red circle', 'yellow rectangle', 'light blue strip', 'gray rectangle', 'brown rectangle', 'green rectangle'] as const;

const SYSTEM = `You place security devices on a branch floor plan. The image is the drawing; SAM 3.1 segmented shapes on it and returned boxes, listed as id: [x, y, w, h] normalised 0..1 (origin top-left) with pixel centres.
First, in "anchors", name what every box is in 1-3 words by looking at the drawing at that location (ATM 1, strong-room safe, strong-room door, back door, window, cash counter 2, UPS, server rack, existing CCTV dome, seat...). Boxes inside the legend, title block or scale bar are "legend" and must not be used as anchors.
Then place each device from the kit next to the real object it protects (aim for 8-16 placements covering the strong room, ATM lobby, entrances, windows, teller area and server room):
- door contacts on doors, glass-break detectors by windows, vibration sensor on each ATM, PIR in rooms and lobbies, panic button at cash counters, OTP keypad at the strong-room door.
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
  const r = await placeOnImage(ctx, {
    image: { bytes: file.bytes, mime }, concepts: SAM_CONCEPTS, system: SYSTEM, purpose: 'Place devices on floor plan (SAM anchors)',
    kit: [...bom.per_branch_items, ...bom.per_site_items], names: new Map(bom.scope_of_supply.map((s) => [s.sku, s.description.slice(0, 70)])),
  });
  ctx.state.floorplan = { image_ref: ref, ...r };
  return summarise(r);
});
