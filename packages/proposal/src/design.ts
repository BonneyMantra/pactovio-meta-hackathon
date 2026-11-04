import { z } from 'zod';
import { ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

export const DesignModel = z.object({
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['rax_product', 'external', 'custom', 'client_system']) })).min(2),
  links: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })).min(1),
  zone_map: z.array(z.object({ site: z.string(), zone: z.string(), device_sku: z.string(), input: z.string(), wiring: z.string() })),
});
export interface DesignResult { architecture: Proposal['architecture']; zone_map: NonNullable<Proposal['site_kit']>['zone_map'] }

const SYSTEM = `You design the system architecture and the per-site zone/wiring map for a security/IoT proposal.
- Architecture: layered nodes (field devices -> site panel/edge -> connectivity -> central platform -> client systems). Node ids are short (n1, n2...). kind: rax_product for the supplier's catalogue items, external for bought-out items, custom for new engineering, client_system for the buyer's own systems. Links must reference existing node ids and say what flows (protocol / signal).
- zone_map: one entry per panel zone for EACH site type in the kits below (site "atm" for the ATM-site panel, "branch" for the branch panel, "site" when there is only one site type). Number zones Z1, Z2... per site; give the device sku wired to it, the panel input name and a one-line wiring note (cable type, normally-closed loop, EOL resistor, relay output). Every alarm input device in a kit gets its own zone (an ATM site typically 6-10 zones, a branch 10-20); outputs (hooter, strobe) go on relay outputs named O1, O2. Use ONLY skus listed under supply lines.`;

export const designArchitecture = (ctx: RunCtx): Promise<string> => runStep(ctx, 'design_architecture', () => !!ctx.state.design, async () => {
  const { rfq, bom, selection } = ctx.state;
  if (!rfq || !bom || !selection) throw new Error('compose_bom must run before design_architecture');
  const user = `${rfq.title} for ${rfq.client.name}. Sites: ${rfq.sites.atm} ATM, ${rfq.sites.branch} branch.
Kit per ATM site: ${bom.per_site_items.map((k) => `${k.sku} x${k.qty}`).join(', ') || 'none'}
Kit per branch: ${bom.per_branch_items.map((k) => `${k.sku} x${k.qty}`).join(', ') || 'none'}
Supply lines: ${bom.scope_of_supply.map((s) => `${s.sku} (${s.type}) ${s.description.slice(0, 80)}`).join('\n')}
Custom work: ${bom.custom_engineering.map((w) => `${w.work_package}: ${w.description.slice(0, 100)}`).join(' | ') || 'none'}
Integration requirements: ${rfq.requirements.filter((r) => r.category === 'integration' || /api|mqtt|soc|cmms|ticket|dashboard/i.test(r.text)).map((r) => r.text).join(' | ').slice(0, 1500)}`;
  const d = await ask(ctx, DesignModel, { purpose: 'Architecture and zone map', role: 'agent', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 6000, name: 'design' });
  const ids = new Set(d.nodes.map((n) => n.id));
  const skus = new Set(bom.scope_of_supply.map((s) => s.sku));
  ctx.state.design = {
    architecture: { nodes: d.nodes, links: d.links.filter((l) => ids.has(l.from) && ids.has(l.to)) },
    zone_map: d.zone_map.filter((z) => skus.has(z.device_sku)).map(({ site, ...z }) => {
      const k = /atm/i.test(site ?? '') ? 'atm' as const : /branch/i.test(site ?? '') ? 'branch' as const : undefined;
      return k ? { ...z, site: k } : z;
    }),
  };
  return `${d.nodes.length} nodes, ${ctx.state.design.zone_map.length} zones`;
});
