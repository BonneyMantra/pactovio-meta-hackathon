// Composes the proposal document in the supplier's learned section order and paginates it into A4 sheets.
import { h } from '../ui.js';
import { notes, list } from './kit.js';
import { cover, executive, requirement, compliance, assumptions, signoff } from './sections-a.js';
import { solution, wiring, floorplan } from './sections-b.js';
import { bom, engineering, plan, commercials, warranty, sources } from './sections-c.js';

// Matched against learned section titles; compliance first so "compliance with requirements" maps correctly.
const KEYS = [['comp', /complian/i], ['exec', /executive|summary/i], ['req', /understanding|requirement/i], ['solution', /solution|architecture|technical/i],
  ['bom', /scope|supply|bill of|bom/i], ['eng', /engineering|custom/i], ['plan', /implementation|plan|schedule|programme/i],
  ['comm', /commercial|pric/i], ['warranty', /warranty|amc|maintenance/i], ['assume', /assumption|exclusion/i]];
export const DEFAULT_ORDER = ['exec', 'req', 'solution', 'bom', 'eng', 'plan', 'comm', 'warranty', 'assume', 'comp'];

export function sectionOrder(titles) {
  const out = [];
  for (const t of list(titles)) {
    const hit = KEYS.find(([k, re]) => re.test(String(t)) && !out.includes(k));
    if (hit) out.push(hit[0]);
  }
  for (const k of DEFAULT_ORDER) if (!out.includes(k)) out.push(k);
  return out;
}

const RENDER = {
  exec: (c, n) => [{ node: executive(c, n), brk: true }],
  req: (c, n) => [{ node: requirement(c, n) }],
  solution: (c, n) => [{ node: solution(c, n), brk: true }, ...wiring(c, n).map((node) => ({ node, brk: true })), { node: floorplan(c, n), brk: true }],
  bom: (c, n) => [{ node: bom(c, n), brk: true }],
  eng: (c, n) => [{ node: engineering(c, n), brk: true }],
  plan: (c, n) => [{ node: plan(c, n) }],
  comm: (c, n) => [{ node: commercials(c, n), brk: true }],
  warranty: (c, n) => [{ node: warranty(c, n) }],
  assume: (c, n) => [{ node: assumptions(c, n), brk: true }],
  comp: (c, n) => [{ node: compliance(c, n), brk: true }],
};
const PRESENT = { eng: (p) => list(p.custom_engineering).length > 0, warranty: (p) => !!p.warranty_amc, plan: (p) => list(p.implementation_plan).length > 0 };

/** ctx: { p, id, supplier, products (Map sku → product), nameOf(sku), thumb(sku), order (titles) } */
export function buildDocument(ctx) {
  const c = { ...ctx, nt: notes() };
  const keys = sectionOrder(ctx.order).filter((k) => !PRESENT[k] || PRESENT[k](ctx.p));
  const blocks = [];
  keys.forEach((k, i) => blocks.push(...RENDER[k](c, i + 1).filter((b) => b.node)));
  blocks.push({ node: signoff(c) });
  const src = sources(c);
  if (src) blocks.push({ node: src, brk: true });
  const sheets = [newSheet(c, h('div.pd-cover-wrap', cover(c)), 'cover')];
  for (const b of blocks) {
    if (b.brk || sheets.length === 1) sheets.push(newSheet(c));
    sheets[sheets.length - 1].body.append(b.node);
  }
  return h('div.pd-doc', sheets.map((s) => s.el));
}

function newSheet(c, content, cls) {
  const body = h('div.pd-body', content);
  const el = h(`section.pd-sheet${cls ? '.pd-' + cls : ''}`,
    cls === 'cover' ? null : h('div.pd-run', h('span', c.supplier), h('span', `${c.p.ref || ''}${c.p.revision ? ` · ${c.p.revision}` : ''}`)),
    body,
    h('div.pd-foot', h('span', cls === 'cover' ? 'Commercial in confidence' : `${c.p.client?.name || ''} · ${c.p.title || ''}`), h('span.pd-pageno')));
  el._body = body;
  return { el, body };
}

const over = (body) => body.scrollHeight > body.clientHeight + 2;

/** Moves trailing blocks (or trailing table rows) onto continuation sheets until nothing overflows. */
export function paginate(doc) {
  let guard = 0;
  for (let i = 0; i < doc.children.length && guard < 200; i++) {
    const sheet = doc.children[i], body = sheet.querySelector('.pd-body');
    if (!body || sheet.classList.contains('pd-cover')) continue;
    while (over(body) && guard++ < 200) {
      const next = continuation(sheet);
      if (body.children.length > 1) { next.querySelector('.pd-body').prepend(body.lastElementChild); continue; }
      if (!splitRows(body.firstElementChild, next.querySelector('.pd-body'), body)) { next.remove(); break; }
    }
  }
  const all = [...doc.querySelectorAll('.pd-sheet')];
  all.forEach((s, i) => { const n = s.querySelector('.pd-pageno'); if (n) n.textContent = `Page ${i + 1} of ${all.length}`; });
}

function continuation(sheet) {
  const nx = sheet.nextElementSibling;
  if (nx?.dataset.cont === '1') return nx;
  const copy = sheet.cloneNode(false);
  copy.dataset.cont = '1';
  copy.append(sheet.querySelector('.pd-run').cloneNode(true), h('div.pd-body'), sheet.querySelector('.pd-foot').cloneNode(true));
  sheet.after(copy);
  return copy;
}

function splitRows(block, target, body) {
  const table = [...block.querySelectorAll('table.pd-table')].pop();
  const rows = table ? [...table.tBodies[0]?.rows || []] : [];
  if (rows.length < 4) return false;
  const cont = table.cloneNode(false);
  cont.append(table.tHead?.cloneNode(true) || '', h('tbody'));
  if (table.tFoot) cont.append(table.tFoot);
  const wrap = h('div.pd-block', h('div.pd-cont', 'continued'), table.parentElement.classList.contains('pd-scroll') ? h('div.pd-scroll', cont) : cont);
  target.prepend(wrap);
  while (over(body) && table.tBodies[0].rows.length > 2) cont.tBodies[0].prepend(table.tBodies[0].lastElementChild);
  // Keep a group heading with the rows it introduces.
  const tail = table.tBodies[0].lastElementChild;
  if (tail?.classList.contains('pd-grp')) cont.tBodies[0].prepend(tail);
  return true;
}
