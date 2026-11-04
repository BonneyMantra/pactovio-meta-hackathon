// Solution architecture as a layered top-to-bottom system diagram, laid out from architecture.nodes/links.
import { esc, list, KIND } from './kit.js';

const NW = 168, GX = 26, GY = 62, PAD = 18, MAX_ROW = 5;

export function wrap(text, max = 24) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length > 3 ? [...lines.slice(0, 2), `${lines.slice(2).join(' ').slice(0, max - 1)}…`] : lines;
}

function ranks(nodes, links) {
  const rank = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const l of links) {
      if (!rank.has(l.from) || !rank.has(l.to) || l.from === l.to) continue;
      const want = rank.get(l.from) + 1;
      if (rank.get(l.to) < want && want < nodes.length) { rank.set(l.to, want); moved = true; }
    }
    if (!moved) break;
  }
  return rank;
}

export function architectureSvg(arch) {
  const nodes = list(arch?.nodes).filter((n) => n && n.id), links = list(arch?.links).filter((l) => l && l.from && l.to);
  if (!nodes.length) return '';
  const rank = ranks(nodes, links);
  const layers = [];
  nodes.forEach((n) => { (layers[rank.get(n.id)] ||= []).push(n); });
  // A wide layer (e.g. ten field devices) wraps onto rows of at most MAX_ROW so the figure stays legible on A4.
  const rows = layers.filter(Boolean).flatMap((l) => Array.from({ length: Math.ceil(l.length / MAX_ROW) }, (_, i) => l.slice(i * MAX_ROW, (i + 1) * MAX_ROW)));
  const pos = new Map();
  const heights = rows.map((row) => Math.max(...(row || []).map((n) => 40 + wrap(n.label).length * 14)));
  const width = Math.max(560, Math.max(...rows.map((r) => (r || []).length)) * (NW + GX) - GX + PAD * 2);
  const place = () => {
    let y = PAD + 4;
    rows.forEach((row = [], r) => {
      const total = row.length * (NW + GX) - GX;
      row.forEach((n, i) => pos.set(n.id, { x: (width - total) / 2 + i * (NW + GX), y, h: heights[r], r }));
      y += heights[r] + GY;
    });
    return y;
  };
  const bary = (n, dir) => {
    const ps = links.filter((l) => (dir > 0 ? l.to === n.id : l.from === n.id)).map((l) => pos.get(dir > 0 ? l.from : l.to)?.x).filter((x) => x != null);
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(n.id)?.x ?? 0;
  };
  // Two sweeps (down, up, down) of barycentre ordering to keep crossings low.
  place();
  for (const dir of [1, -1, 1]) {
    const order = dir > 0 ? rows.map((_, i) => i).slice(1) : rows.map((_, i) => i).reverse().slice(1);
    for (const r of order) { (rows[r] || []).sort((a, b) => bary(a, dir) - bary(b, dir)); place(); }
  }
  let y = place();
  const height = y - GY + PAD;
  // Spread ports so parallel edges leave and arrive side by side.
  const outs = new Map(), ins = new Map();
  for (const l of links) { (outs.get(l.from) || outs.set(l.from, []).get(l.from)).push(l); (ins.get(l.to) || ins.set(l.to, []).get(l.to)).push(l); }
  const port = (m, id, l) => { const arr = m.get(id) || [l]; const i = arr.indexOf(l); return (i + 1) / (arr.length + 1); };
  for (const [id, arr] of outs) arr.sort((a, b) => (pos.get(a.to)?.x ?? 0) - (pos.get(b.to)?.x ?? 0));
  for (const [id, arr] of ins) arr.sort((a, b) => (pos.get(a.from)?.x ?? 0) - (pos.get(b.from)?.x ?? 0));

  const taken = [];
  const free = (x, y, w) => { let yy = y; while (taken.some((t) => Math.abs(t.y - yy) < 17 && Math.abs(t.x - x) < (t.w + w) / 2 + 4)) yy += 18; taken.push({ x, y: yy, w }); return yy; };
  const edges = links.filter((l) => pos.has(l.from) && pos.has(l.to)).map((l) => {
    const a = pos.get(l.from), b = pos.get(l.to);
    const sx = a.x + NW * port(outs, l.from, l), tx = b.x + NW * port(ins, l.to, l);
    let d, mx, my;
    if (b.r > a.r) {
      const sy = a.y + a.h, ty = b.y - 3, dy = (ty - sy) / 2;
      d = `M${sx} ${sy} C${sx} ${sy + dy},${tx} ${ty - dy},${tx} ${ty}`; mx = (sx + tx) / 2; my = (sy + ty) / 2;
    } else {
      const sy = a.y + a.h / 2, ty = b.y + b.h / 2, side = a.x < b.x ? 1 : -1;
      const x1 = a.x + (side > 0 ? NW : 0), x2 = b.x + (side > 0 ? 0 : NW);
      d = `M${x1} ${sy} C${x1 + side * 30} ${sy},${x2 - side * 30} ${ty},${x2 - side * 3} ${ty}`; mx = (x1 + x2) / 2; my = (sy + ty) / 2;
    }
    const lw = Math.min(150, String(l.label || '').length * 5.4 + 12);
    if (l.label) my = free(mx, my, lw);
    return `<g class="e"><path d="${d}" marker-end="url(#pd-arrow)"/>${l.label ? `<rect class="el" x="${mx - lw / 2}" y="${my - 8}" width="${lw}" height="16" rx="8"/><text class="et" x="${mx}" y="${my + 3.5}">${esc(String(l.label).slice(0, 28))}</text>` : ''}</g>`;
  }).join('');

  const boxes = nodes.map((n) => {
    const p = pos.get(n.id), k = KIND[n.kind] || KIND.external, lines = wrap(n.label);
    const ty = p.y + 30 + (p.h - 40 - lines.length * 14) / 2;
    return `<g class="n n-${k.tone}"><rect x="${p.x}" y="${p.y}" width="${NW}" height="${p.h}" rx="7"/>`
      + `<text class="nk" x="${p.x + 12}" y="${p.y + 16}">${esc(k.label.toUpperCase())}</text>`
      + lines.map((t, i) => `<text class="nl" x="${p.x + 12}" y="${ty + i * 14}">${esc(t)}</text>`).join('') + '</g>';
  }).join('');

  return `<svg class="pd-arch" viewBox="0 0 ${width} ${height}" role="img" aria-label="Solution architecture diagram" preserveAspectRatio="xMidYMin meet">
<defs><marker id="pd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0.8 7 4 0 7.2z" class="ah"/></marker></defs>
${edges}${boxes}</svg>`;
}

export function kindLegend(nodes) {
  const kinds = [...new Set(list(nodes).map((n) => n.kind))].filter((k) => KIND[k]);
  return kinds.map((k) => `<span class="pd-lg pd-lg-${KIND[k].tone}"><i></i>${esc(KIND[k].label)}</span>`).join('');
}
