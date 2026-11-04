import type { Env } from '@pactovio/contracts/env';
import { getBrain } from './autopilot-seams';
import type { OnboardingState } from './onboarding-state';

const MAX_SKUS = 40;
const MAX_REFS = 25;

/** Compact, deterministic text of the workspace's real catalogue and (when B1 is wired) Company Brain evidence. Empty when there is neither. */
export async function brainText(env: Env, workspace: string): Promise<string> {
  const prods = (await env.DB.prepare('SELECT sku, name, family FROM products WHERE workspace_id = ? ORDER BY sku LIMIT 400').bind(workspace).all<{ sku: string; name: string; family: string | null }>()).results;
  const brain = await getBrain(env, workspace);
  const lines: string[] = [];
  if (prods.length) {
    const hot = new Set((brain?.top_products ?? []).map((p) => p.sku));
    const ordered = [...prods.filter((p) => hot.has(p.sku)), ...prods.filter((p) => !hot.has(p.sku))].slice(0, MAX_SKUS);
    lines.push(`Catalogue (${prods.length} products, first ${ordered.length}): ${ordered.map((p) => `[${p.sku}] ${p.name}${p.family ? ` (${p.family})` : ''}`).join('; ')}.`);
  }
  if (brain?.proposals_learned) {
    lines.push(`Company Brain: learned from ${brain.proposals_learned} past proposals${brain.win_rate != null ? `, win rate ${Math.round(brain.win_rate * 100)}%` : ''}.`);
    if (brain.by_sector.length) lines.push(`Sectors served: ${brain.by_sector.slice(0, 8).map((s) => `${s.sector} (${s.count})`).join('; ')}.`);
    if (brain.past_proposals.length) lines.push(`Past proposals: ${brain.past_proposals.slice(0, MAX_REFS).map((p) => `[${p.ref}] ${[p.client, p.solution_type].filter(Boolean).join(', ')}`).join('; ')}.`);
  }
  return lines.join('\n');
}

/** Profile plus catalogue/brain evidence. Never throws: without a catalogue it returns the state unchanged. */
export async function withBrain(env: Env, workspace: string, state: OnboardingState): Promise<OnboardingState & { brainText?: string }> {
  try {
    const text = await brainText(env, workspace);
    return text ? { ...state, brainText: text } : state;
  } catch { return state; }
}
