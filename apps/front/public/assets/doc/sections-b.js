// Proposal sections: solution and architecture, per-site wiring schematics, floor plan with device placements.
import { h } from '../ui.js';
import { list, qty, assetUrl, paras, sectionHead } from './kit.js';
import { architectureSvg, kindLegend } from './arch-svg.js';
import { wiringSvg, siteGroups } from './wiring-svg.js';

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

/** One block per site type: the zone schematic and the per-site kit. Returns [] when there is no zone map. */
export function wiring(c, num) {
  const kit = c.p.site_kit, groups = siteGroups(kit);
  if (!groups.length) return [];
  return groups.map((g, gi) => h('div',
    gi === 0 ? sectionHead(`${num}.2`, 'Site Kit & Zone Wiring', 'Proposed Solution & Architecture') : null,
    gi === 0 ? h('p.pd-lead', 'Every site of a type receives the same kit, wired to the alarm panel as shown. Zone inputs, cable and loop type follow the panel’s terminal schedule.') : null,
    h('figure.pd-fig-block',
      h('div.pd-fig-head', h('span.pd-label', `Figure ${num}.${gi + 2}`), h('span', `Typical ${siteName(g.key)} — ${g.zones.length} zone${g.zones.length === 1 ? '' : 's'}`),
        kit?.sites?.[g.key] ? h('span.pd-chip', `× ${qty(kit.sites[g.key])} sites`) : null),
      h('div.pd-svg', { html: wiringSvg(g.zones, g.items, c.nameOf, { title: `${siteName(g.key)} wiring schematic` }) })),
    h('div.pd-kit',
      h('div.pd-label', `Kit per ${siteName(g.key)}`),
      h('div.pd-kit-items', list(g.items).map((i) => h('span.pd-kit-item', h('b', `${qty(i.qty)}×`), c.nameOf(i.sku) || i.sku, h('span.pd-mono.pd-muted', i.sku))))),
    h('table.pd-table.pd-zones', h('thead', h('tr', h('th', 'Input'), h('th', 'Zone'), h('th', 'Device'), h('th', 'Wiring'))),
      h('tbody', g.zones.map((z) => h('tr', h('td.pd-mono', z.input), h('td', z.zone), h('td.pd-mono', z.device_sku), h('td.pd-muted', z.wiring)))))));
}

const TONE = (sku) => (/CCTV|CAM/.test(sku) ? 'cam' : /^RT-/.test(sku) ? 'rax' : 'ext');

export function floorplan(c, num) {
  const fp = c.p.floorplan, src = assetUrl(c.id, fp?.image_ref), pl = list(fp?.placements);
  if (!src) return null;
  const sam = pl.length && pl.every((x) => /sam/i.test(x.source || ''));
  const marks = pl.map((x, i) => {
    const [bx, by, bw, bh] = (x.box || []).map(Number);
    if (![bx, by, bw, bh].every(Number.isFinite)) return null;
    return h(`div.pd-mark.${TONE(x.device_sku)}`, { style: { left: `${bx * 100}%`, top: `${by * 100}%`, width: `${bw * 100}%`, height: `${bh * 100}%` }, title: `${x.label} · ${x.device_sku}` },
      h('span', String(i + 1)));
  });
  return h('div',
    sectionHead(`${num}.${2 + siteGroups(c.p.site_kit).length}`, 'Device Placement', 'Proposed Solution & Architecture'),
    h('p.pd-lead', fp.site ? `Proposed device positions — ${fp.site}.` : 'Proposed device positions on the client drawing.',
      sam ? ' Positions were located on the drawing with SAM 3.1 and reviewed against the kit.' : ''),
    h('figure.pd-fig-block',
      h('div.pd-plan', h('img', { src, alt: `Floor plan${fp.site ? ` — ${fp.site}` : ''}` }), h('div.pd-marks', marks))),
    h('div.pd-place', pl.map((x, i) => h('div', h(`span.pd-dot.${TONE(x.device_sku)}`, String(i + 1)),
      h('div', h('div', x.label), h('div.pd-muted.pd-xs', c.nameOf(x.device_sku) || x.device_sku, ' · ', h('span.pd-mono', x.device_sku)))))),
    sam ? h('p.pd-muted.pd-xs', { style: { marginTop: '2mm' } }, 'Located by SAM 3.1 on the client drawing; final positions are confirmed at site survey.') : null);
}
