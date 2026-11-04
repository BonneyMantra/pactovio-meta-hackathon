import { z } from 'zod';
import { ask, runStep, type RunCtx } from './ctx';
import type { Proposal } from './schema';

const DesignModel = z.object({
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(['rax_product', 'external', 'custom', 'client_system']) })).min(2),
  links: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })).min(1),
  zone_map: z.array(z.object({ zone: z.string(), device_sku: z.string(), input: z.string(), wiring: z.string() })),
});
export interface DesignResult { architecture: Proposal['architecture']; zone_map: NonNullable<Proposal['site_kit']>['zone_map'] }

const SYSTEM = `You design the system architecture and the per-site zone/wiring map for a security/IoT proposal.
- Architecture: layered nodes (field devices -> site panel/edge -> connectivity -> central platform -> client systems). Node ids are short (n1, n2...). kind: rax_product for the supplier's catalogue items, external for bought-out items, custom for new engineering, client_system for the buyer's own systems. Links must reference existing node ids and say what flows (protocol / signal).
- zone_map: for the typical ATM-site panel list each zone Z1, Z2... with the device sku wired to it, the panel input name and a one-line wiring note (cable type, normally-closed loop, EOL resistor, relay output). Use ONLY skus listed under supply lines. Zones come from the requirements (door contacts, PIR, vibration, glass-break, panic, hooter, power); omit devices not supplied.`;

export const designArchitecture = (ctx: RunCtx): Promise<string> => runStep(ctx, 'design_architecture', () => !!ctx.state.design, async () => {
  const { rfq, bom, selection } = ctx.state;
  if (!rfq || !bom || !selection) throw new Error('compose_bom must run before design_architecture');
  const user = `${rfq.title} for ${rfq.client.name}. Sites: ${rfq.sites.atm} ATM, ${rfq.sites.branch} branch.
Supply lines: ${bom.scope_of_supply.map((s) => `${s.sku} (${s.type}) ${s.description.slice(0, 80)}`).join('\n')}
Custom work: ${bom.custom_engineering.map((w) => `${w.work_package}: ${w.description.slice(0, 100)}`).join(' | ') || 'none'}
Integration requirements: ${rfq.requirements.filter((r) => r.category === 'integration' || /api|mqtt|soc|cmms|ticket|dashboard/i.test(r.text)).map((r) => r.text).join(' | ').slice(0, 1500)}`;
  const d = await ask(ctx, DesignModel, { purpose: 'Architecture and zone map', role: 'reason', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], maxTokens: 4500, name: 'design' });
  const ids = new Set(d.nodes.map((n) => n.id));
  const skus = new Set(bom.scope_of_supply.map((s) => s.sku));
  ctx.state.design = {
    architecture: { nodes: d.nodes, links: d.links.filter((l) => ids.has(l.from) && ids.has(l.to)) },
    zone_map: d.zone_map.filter((z) => skus.has(z.device_sku)),
  };
  return `${d.nodes.length} nodes, ${ctx.state.design.zone_map.length} zones`;
});
