import { generateImage } from '@pactovio/models';
import { assetKey, putAsset } from './assets';
import { runStep, addUsage, type RunCtx } from './ctx';
import { placeOnImage, summarise, type PlaceResult } from './place';

export const CONCEPT_LABEL = 'Concept visual — generated, not a product photo' as const;
export type VisualState = { image_key: string; prompt: string; site?: string } & Partial<PlaceResult>;

/** Muse Image prompt from the proposal's own subject: no text, logos or faces so nothing in it can be mistaken for fact. */
export function visualPrompt(title: string, sector: string, overview: string): string {
  const gist = overview.replace(/\s+/g, ' ').split(/(?<=\.)\s/)[0]?.slice(0, 260) ?? '';
  return `Photorealistic concept visual for a technical proposal titled "${title}" (${sector}). Scene: ${gist} Clean, calm, well-lit, wide composition, subtle blue accent lighting. No text, no logos, no brand names, no readable screens, no identifiable faces.`;
}

/** A typical ATM site of this buyer, composed so SAM 3.1 can separate the objects the kit protects. */
export function atmLobbyPrompt(city: string): string {
  return `Photorealistic interior photograph of an Indian bank 24x7 ATM lobby${city ? ` in ${city}` : ''}, eye-level wide shot from just inside the glass entrance door, 24 mm lens, crisp focus, 3:2 landscape.
Two free-standing ATM machines side by side along the back wall, clearly separate and fully visible, plain grey-and-charcoal fascia with a generic blue screen, steel keypad, card and cash slots; no logos or readable text.
Foreground left: a frameless glass entrance door with a steel handle. Right wall: a plain notice panel with unreadable print, a small bin, and a red emergency panic button at shoulder height.
Ceiling: white false ceiling with recessed LED panels; one white CCTV dome camera clearly visible above the lobby centre, a small smoke detector and a PIR motion sensor in the upper corner.
Floor: polished beige tiles. No people, no logos, no brand names, no watermarks, no legible text. The ATMs, door, ceiling devices and panic button must be clean, unoccluded and clearly separable.`;
}

/** Natural-language SAM 3.1 concepts for a photographed (or photoreal) ATM lobby. */
export const PHOTO_CONCEPTS = ['ATM machine', 'glass door', 'dome camera', 'red button', 'ceiling light', 'smoke detector'] as const;

const PHOTO_SYSTEM = `You place security devices on a photo of a typical ATM lobby. SAM 3.1 segmented objects in the photo and returned boxes, listed as id: [x, y, w, h] normalised 0..1 (origin top-left).
First, in "anchors", name what every box is in 1-3 words by looking at the photo (ATM 1, ATM 2, glass entrance door, CCTV dome, panic button, ceiling light, smoke detector...).
Then place each device of the ATM-site kit where an installer would fit it, anchored to the object it protects: vibration/seismic sensor on each ATM, door contact on the entrance door, glass-break detector near the glazing, PIR on the ceiling, panic button by the existing button position, hooter/strobe above the door, 2-way audio speaker and edge-analytics camera near the ceiling centre, the alarm panel and 4G communicator on a wall. Aim for 6-10 placements.
Use anchor_id with a "where" offset when a listed box is right; otherwise anchor_id null with approx_xy. Label each with the device and the place ("Vibration sensor - ATM 2"). Only use skus from the kit.`;

export const makeVisual = (ctx: RunCtx): Promise<string> => runStep(ctx, 'concept_visual', () => !!ctx.state.visual, async () => {
  const { rfq, bom } = ctx.state;
  if (!rfq || !bom) throw new Error('compose_bom must run before concept_visual');
  const atm = rfq.sites.atm > 0 && bom.per_site_items.length > 0;
  const prompt = atm ? atmLobbyPrompt(rfq.client.city) : visualPrompt(bom.title, rfq.client.sector, bom.solution_overview);
  let img: Awaited<ReturnType<typeof generateImage>>;
  try {
    img = await generateImage(ctx.env, { prompt, size: '1536x1024', format: 'jpeg', fast: true, fetchImpl: ctx.fetchImpl });
  } catch (e) {
    // The visual is decoration; a refusal or outage must not sink the proposal.
    ctx.state.visual = { skipped: e instanceof Error ? e.message.slice(0, 160) : 'image generation failed' };
    return `skipped: ${(ctx.state.visual as { skipped: string }).skipped}`;
  }
  addUsage(ctx, { model: img.model, costUsd: img.costUsd, ms: img.ms });
  const key = assetKey(ctx.workspaceId, ctx.proposalId, 'concept.jpg');
  await putAsset(ctx.env, key, img.bytes, img.mime);
  const v: VisualState = { image_key: key, prompt, ...(atm ? { site: 'typical ATM lobby' } : {}) };
  let placed = '';
  if (atm) {
    try {
      const r = await placeOnImage(ctx, {
        image: { bytes: img.bytes, mime: img.mime }, concepts: PHOTO_CONCEPTS, system: PHOTO_SYSTEM, purpose: 'Place ATM-site kit on the site visual (SAM anchors)',
        kit: bom.per_site_items, names: new Map(bom.scope_of_supply.map((s) => [s.sku, s.description.slice(0, 70)])), ignore: /^$/,
      });
      Object.assign(v, r);
      placed = `; ${summarise(r)}`;
    } catch { /* placement on the visual is optional */ }
  }
  ctx.state.visual = v;
  return `generated ${(img.bytes.length / 1024).toFixed(0)} KB${placed}`;
});
