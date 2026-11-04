import { generateImage } from '@pactovio/models';
import { assetKey, putAsset } from './assets';
import { addUsage, runStep, type RunCtx } from './ctx';

export const CONCEPT_LABEL = 'Concept visual — generated, not a product photo' as const;

/** Muse Image prompt from the proposal's own subject: no text, logos or faces so nothing in it can be mistaken for fact. */
export function visualPrompt(title: string, sector: string, overview: string): string {
  const gist = overview.replace(/\s+/g, ' ').split(/(?<=\.)\s/)[0]?.slice(0, 260) ?? '';
  return `Photorealistic concept visual for a technical proposal titled "${title}" (${sector}). Scene: ${gist} Clean, calm, well-lit, wide composition, subtle blue accent lighting. No text, no logos, no brand names, no readable screens, no identifiable faces.`;
}

export const makeVisual = (ctx: RunCtx): Promise<string> => runStep(ctx, 'concept_visual', () => !!ctx.state.visual, async () => {
  const { rfq, bom } = ctx.state;
  if (!rfq || !bom) throw new Error('compose_bom must run before concept_visual');
  const prompt = visualPrompt(bom.title, rfq.client.sector, bom.solution_overview);
  try {
    const img = await generateImage(ctx.env, { prompt, size: '1536x1024', format: 'jpeg', fast: true, fetchImpl: ctx.fetchImpl });
    addUsage(ctx, { model: img.model, costUsd: img.costUsd, ms: img.ms });
    const key = assetKey(ctx.workspaceId, ctx.proposalId, 'concept.jpg');
    await putAsset(ctx.env, key, img.bytes, img.mime);
    ctx.state.visual = { image_key: key, prompt };
    return `generated ${(img.bytes.length / 1024).toFixed(0)} KB in ${img.ms} ms`;
  } catch (e) {
    // The visual is decoration; a refusal or outage must not sink the proposal.
    ctx.state.visual = { skipped: e instanceof Error ? e.message.slice(0, 160) : 'image generation failed' };
    return `skipped: ${(ctx.state.visual as { skipped: string }).skipped}`;
  }
});
