// Proposal sections: solution and architecture, per-site kits and zone wiring, device placement on the drawing and the site visual.
import { h } from '../ui.js';
import { list, qty, assetUrl, paras, sectionHead } from './kit.js';
import { architectureSvg, kindLegend } from './arch-svg.js';
import { wiringSvg } from './wiring-svg.js';
import { placementFigure, placementLead } from './placement.js';

export function solution(c, num) {
  const { p } = c;
  const svg = architectureSvg(p.architecture);
  return h('div',
    sectionHead(num, 'Proposed Solution & Architecture'),
    h('div.pd-prose', paras(p.solution_overview, p.evidence, c.nt)),
    svg ? h('figure.pd-fig-block',
      h('div.pd-fig-head', h('span.pd-label', `Figure ${num}.1`), h('span', 'System architecture'), h('span.pd-legend', { html: kindLegend(p.architecture?.nodes) })),
      h('div.pd-svg', { html: svg })) : null);
}

const SITE_NAME = { atm: 'ATM site', branch: 'branch', site: 'site', dc: 'distribution centre', station: 'station' };
const siteName = (k) => SITE_NAME[k] || String(k).replace(/_/g, ' ');

/** Site types with their zones and kit: per_site_items is the ATM kit when a branch kit also exists. */
export function kitGroups(kit) {
  const zones = list(kit?.zone_map), siteItems = list(kit?.per_site_items), branchItems = list(kit?.per_branch_items);
  const def = branchItems.length ? 'atm' : 'site';
  const keys = [...new Set(zones.map((z) => z.site || def))];
  if (!keys.includes(def) && siteItems.length) keys.unshift(def);
  if (branchItems.length && !keys.includes('branch')) keys.push('branch');
  return keys.map((k) => ({ key: k, zones: zones.filter((z) => (z.site || def) === k), items: k === 'branch' ? branchItems : k === def ? siteItems : [] }))
    .filter((g) => g.zones.length || g.items.length);
}

function sitePhoto(c, g) {
  const cv = c.p.concept_visual, src = assetUrl(c.id, cv?.image_ref);
  if (!src || !list(cv?.placements).length || !(g.key === 'atm' || (g.key === 'site' && c.p.site_kit?.sites?.atm))) return null;
  const [fig, legend] = placementFigure(c, cv, src, { alt: `Device positions at a ${cv.site || 'typical site'}`, caption: 'Concept visual by Muse Image, not a photo of a client site', wide: true });
  return h('div.pd-block',
    h('div.pd-fig-head', h('span.pd-label', 'Typical ATM site'), h('span', 'Where each device goes')),
    h('p.pd-lead', `Device positions on a ${cv.site || 'typical site'}.${placementLead(cv, 'in the image')}`), fig, legend);
}

/** One block per site type: the zone schematic, the per-site kit and, for ATM sites, positions on the site visual. */
export function wiring(c, num) {
  const kit = c.p.site_kit, groups = kitGroups(kit);
  if (!groups.length) return [];
  return groups.map((g, gi) => h('div',
    gi === 0 ? sectionHead(`${num}.2`, 'Site Kit & Zone Wiring', 'Proposed Solution & Architecture') : null,
    gi === 0 ? h('p.pd-lead', 'Every site of a type receives the same kit, wired to the alarm panel as shown. Zone inputs, cable and loop type follow the panel’s terminal schedule.') : null,
    g.zones.length ? h('figure.pd-fig-block',
      h('div.pd-fig-head', h('span.pd-label', `Figure ${num}.${gi + 2}`), h('span', `Typical ${siteName(g.key)} — ${g.zones.length} zone${g.zones.length === 1 ? '' : 's'}`),
        kit?.sites?.[g.key] ? h('span.pd-chip', `× ${qty(kit.sites[g.key])} sites`) : null),
      h('div.pd-svg', { html: wiringSvg(g.zones, g.items, c.nameOf, { title: `${siteName(g.key)} wiring schematic` }) })) : null,
    h('div.pd-kit',
      h('div.pd-label', `Kit per ${siteName(g.key)}`, !g.zones.length && kit?.sites?.[g.key] ? ` · × ${qty(kit.sites[g.key])} sites` : ''),
      h('div.pd-kit-items', list(g.items).map((i) => h('span.pd-kit-item', h('b', `${qty(i.qty)}×`), c.nameOf(i.sku) || i.sku, h('span.pd-mono.pd-muted', i.sku))))),
    g.zones.length ? h('table.pd-table.pd-zones', h('thead', h('tr', h('th', 'Input'), h('th', 'Zone'), h('th', 'Device'), h('th', 'Wiring'))),
      h('tbody', g.zones.map((z) => h('tr', h('td.pd-mono', z.input), h('td', z.zone), h('td.pd-mono', z.device_sku), h('td.pd-muted', z.wiring))))) : null,
    sitePhoto(c, g)));
}

export function floorplan(c, num) {
  const fp = c.p.floorplan, src = assetUrl(c.id, fp?.image_ref);
  if (!src) return null;
  const [fig, legend] = placementFigure(c, fp, src, { alt: `Floor plan${fp.site ? ` — ${fp.site}` : ''}` });
  return h('div',
    sectionHead(`${num}.${2 + kitGroups(c.p.site_kit).length}`, 'Device Placement', 'Proposed Solution & Architecture'),
    h('p.pd-lead', fp.site ? `Proposed device positions — ${fp.site}.` : 'Proposed device positions on the client’s typical branch drawing.', placementLead(fp, 'on the drawing')),
    fig, legend,
    h('p.pd-muted.pd-xs', { style: { marginTop: '2mm' } }, 'Final positions are confirmed at the site survey of each branch.'));
}
