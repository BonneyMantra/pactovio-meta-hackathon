import { fmtInr, groupInr } from './money';
import type { Proposal } from './schema';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const para = (s: string): string => s.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
const cell = (c: unknown): string => `<td${typeof c === 'number' || /^₹/.test(String(c)) ? ' class="n"' : ''}>${esc(c)}</td>`;
const rows = (cells: unknown[][]): string => cells.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
const table = (head: string[], body: unknown[][]): string => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows(body)}</tbody></table>`;

export interface HtmlOpts {
  seller: string;
  /** Base URL for the proposal's images, e.g. `/api/proposals/<id>/assets` (no trailing slash). */
  assetBase: string;
}

/**
 * Neutral print-ready HTML for a proposal (server side, no scripts, all text escaped). The product UI renders its own
 * designed view from the same JSON; this is the fallback for GET /api/proposals/:id/pdf and for Print to PDF.
 */
export function renderProposalHtml(p: Proposal, o: HtmlOpts): string {
  const c = p.commercials;
  const fp = p.floorplan;
  const overlay = fp ? fp.placements.map((pl, i) => `<span class="pin ${pl.source === 'sam-3.1' ? 'sam' : 'est'}" style="left:${pl.box[0] * 100}%;top:${pl.box[1] * 100}%;width:${pl.box[2] * 100}%;height:${pl.box[3] * 100}%" title="${esc(pl.label)}">${i + 1}</span>`).join('') : '';
  const sec = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)} - ${esc(p.ref)}</title>
<style>
@page{size:A4;margin:16mm}body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1b1f24;max-width:920px;margin:0 auto;padding:24px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:2px solid #1b1f24;padding-bottom:4px;break-after:avoid}
.meta{color:#5a6472;font-size:13px}table{border-collapse:collapse;width:100%;font-size:12.5px;margin:8px 0}th,td{border:1px solid #cfd5dc;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#eef1f4}td.n{text-align:right;white-space:nowrap}section{break-inside:auto}tr{break-inside:avoid}
.fp{position:relative;display:inline-block;max-width:100%}.fp img{display:block;max-width:100%}.pin{position:absolute;border:2px solid #0a7;background:rgba(0,170,119,.18);font-size:9px;color:#064;display:flex;align-items:center;justify-content:center;border-radius:3px}
.pin.est{border-color:#c80;background:rgba(204,136,0,.18);color:#740}.cv img{max-width:100%;border-radius:6px}.label{font-size:12px;color:#5a6472}
.status-complies{color:#0a6b3d}.status-partial{color:#9a6200}.status-deviation{color:#b3261e}.tot td{font-weight:600}
</style></head><body>
<h1>${esc(p.title)}</h1><div class="meta">${esc(o.seller)} | Ref ${esc(p.ref)} ${esc(p.revision)} | ${esc(p.date)} | Valid ${p.validity_days} days<br>Prepared for ${esc(p.client.name)}, ${esc(p.client.city)}, ${esc(p.client.country)} | RFQ ${esc(p.rfq_ref)}</div>
${p.concept_visual ? `<div class="cv"><img src="${o.assetBase}/${esc(p.concept_visual.image_ref)}" alt="Concept visual"><div class="label">${esc(p.concept_visual.label)}</div></div>` : ''}
${sec('Executive summary', para(p.executive_summary))}
${sec('Requirement understanding', `<ul>${p.requirement_understanding.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`)}
${sec('Solution overview', para(p.solution_overview))}
${sec('Architecture', table(['From', 'To', 'Carries'], p.architecture.links.map((l) => [p.architecture.nodes.find((n) => n.id === l.from)?.label ?? l.from, p.architecture.nodes.find((n) => n.id === l.to)?.label ?? l.to, l.label])))}
${p.site_kit?.zone_map.length ? sec('Zone and wiring map (typical ATM site)', table(['Zone', 'Device', 'Input', 'Wiring'], p.site_kit.zone_map.map((z) => [z.zone, z.device_sku, z.input, z.wiring]))) : ''}
${fp ? sec('Device placement on floor plan', `<div class="fp"><img src="${o.assetBase}/${esc(fp.image_ref)}" alt="Floor plan">${overlay}</div>${table(['#', 'Device', 'Label', 'Located by'], fp.placements.map((pl, i) => [i + 1, pl.device_sku, pl.label, pl.source === 'sam-3.1' ? 'SAM 3.1 object' : 'Vision estimate']))}`) : ''}
${sec('Scope of supply', table(['SKU', 'Description', 'Type', 'Qty', 'Unit price', 'Amount'], p.scope_of_supply.map((l) => [l.sku, l.description, l.type, groupInr(l.qty), fmtInr(l.unit_price_inr), fmtInr(l.amount_inr)])))}
${p.custom_engineering.length ? sec('Custom engineering', table(['Work package', 'Description', 'Person-days', 'Rate/day', 'Amount'], p.custom_engineering.map((w) => [w.work_package, w.description, w.person_days, fmtInr(w.rate_inr), fmtInr(Math.round(w.person_days * w.rate_inr))]))) : ''}
${sec('Implementation plan', table(['Phase', 'Start week', 'Weeks', 'Deliverables'], p.implementation_plan.map((x) => [x.name, x.start_week ?? '', x.weeks, x.deliverables])))}
${sec('Commercials', `<table><tbody>${[['Supply subtotal', c.supply_subtotal_inr], ['Engineering subtotal', c.engineering_subtotal_inr], ['Subtotal', c.subtotal], [`Discount (${c.discount_pct}%)`, -c.discount_inr], ['Taxable value', c.taxable_inr], [`GST ${c.gst_pct}%`, c.gst_inr]].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${fmtInr(v as number)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="n">${fmtInr(c.total_inr)}</td></tr></tbody></table><p>${esc(c.payment_terms)}</p>${c.note ? `<p class="label">${esc(c.note)}</p>` : ''}`)}
${sec('Warranty and AMC', `<p>${esc(p.warranty_amc.text)}</p><p>AMC: ${p.warranty_amc.amc_pct_of_hardware}% of hardware value ${fmtInr(p.warranty_amc.amc_hardware_base_inr)} = ${fmtInr(p.warranty_amc.amc_annual_inr)} per year.</p>`)}
${sec('Compliance matrix', `<table><thead><tr><th>Requirement</th><th>Status</th><th>Remark</th><th>Page</th></tr></thead><tbody>${p.compliance.map((x) => `<tr><td>${esc(x.requirement)}</td><td class="status-${x.status}">${esc(x.status)}</td><td>${esc(x.remark)}</td><td>${x.page ?? ''}</td></tr>`).join('')}</tbody></table>`)}
${sec('Assumptions', `<ul>${p.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`)}
${sec('Exclusions', `<ul>${p.exclusions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`)}
${sec('Evidence', table(['Claim', 'Source'], p.evidence.map((e) => [e.claim, 'doc' in e.source ? `${e.source.doc}${e.source.page ? `, p.${e.source.page}` : ''}` : 'product_sku' in e.source ? `Catalogue ${e.source.product_sku}` : `Past proposal ${e.source.past_proposal_ref}`])))}
</body></html>`;
}
