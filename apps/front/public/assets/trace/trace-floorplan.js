// Floor-plan layer for /trace: SAM 3.1 objects (named by Muse Spark) and the devices code placed beside them.
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };

export function drawFloorplan(fp, h) {
  const img = document.getElementById('tr-fp-img');
  const svg = document.getElementById('tr-fp-svg');
  const tip = document.getElementById('tr-tip');
  const stage = document.getElementById('tr-fp-stage');
  const list = document.getElementById('tr-devices');
  const note = document.getElementById('tr-fp-note');
  img.src = fp.image;
  const W = fp.width, H = fp.height;
  const sam = fp.placements.filter((p) => p.source === 'sam-3.1').length;

  const show = (el, lines) => {
    const r = stage.getBoundingClientRect(), b = el.getBoundingClientRect();
    tip.replaceChildren(...lines.map((l, i) => h('div', i ? { class: 'mono' } : {}, l)));
    tip.style.left = `${Math.min(Math.max(b.left - r.left + b.width / 2, 90), r.width - 90)}px`;
    tip.style.top = `${b.top - r.top}px`;
    tip.hidden = false;
  };
  const hide = () => { tip.hidden = true; };

  const objects = () => fp.objects.map((o) => {
    const [x, y, w, hh] = o.box;
    const el = svgEl('rect', { class: 'tr-obj', x: x * W, y: y * H, width: Math.max(w * W, 6), height: Math.max(hh * H, 6), rx: 3, 'data-k': o.id, tabindex: 0, 'aria-label': `${o.what}, SAM 3.1 object ${o.id}` });
    const lines = [o.what, `${o.id} · SAM 3.1 box, named by Muse Spark`];
    el.addEventListener('mouseenter', () => show(el, lines)); el.addEventListener('focus', () => show(el, lines));
    el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide);
    return el;
  });

  const lis = [];
  const devices = () => fp.placements.map((p, i) => {
    const [x, y, w, hh] = p.box;
    const cx = (x + w / 2) * W, cy = (y + hh / 2) * H, est = p.source !== 'sam-3.1';
    const g = svgEl('g', { 'data-k': String(i), tabindex: 0, 'aria-label': `${i + 1}: ${p.label}, ${p.device_sku}` });
    g.append(svgEl('circle', { class: `tr-dev${est ? ' est' : ''}`, cx, cy, r: 24 }), Object.assign(svgEl('text', { class: `tr-num${est ? ' est' : ''}`, x: cx, y: cy }), { textContent: String(i + 1) }));
    const lines = [p.label, `${p.device_sku} · ${est ? 'estimated by Muse Spark (no SAM anchor)' : `beside “${p.anchor}” (SAM 3.1)`}`];
    const on = (v) => { g.querySelector('circle').classList.toggle('on', v); lis[i]?.classList.toggle('on', v); };
    g.addEventListener('mouseenter', () => { show(g, lines); on(true); }); g.addEventListener('focus', () => { show(g, lines); on(true); });
    g.addEventListener('mouseleave', () => { hide(); on(false); }); g.addEventListener('blur', () => { hide(); on(false); });
    return g;
  });

  list.replaceChildren(...fp.placements.map((p, i) => {
    const li = h('li', {}, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', {}, p.label), h('span', { class: 's' }, p.source === 'sam-3.1' ? `SAM · ${p.anchor}` : 'estimated'));
    lis.push(li);
    li.addEventListener('mouseenter', () => svg.querySelector(`g[data-k="${i}"]`)?.dispatchEvent(new Event('mouseenter')));
    li.addEventListener('mouseleave', () => svg.querySelector(`g[data-k="${i}"]`)?.dispatchEvent(new Event('mouseleave')));
    return li;
  }));

  const layer = (name) => {
    hide();
    svg.replaceChildren(...(name === 'objects' ? objects() : devices()));
    list.hidden = name === 'objects';
    note.textContent = name === 'objects'
      ? `${fp.sam_calls} SAM 3.1 calls with shape and colour prompts returned candidate boxes; Muse Spark looked at the drawing and named the ${fp.objects.length} that are real objects, shown here. SAM does not find “ATM” on a line drawing, but it finds the dark blue rectangle that is one.`
      : `${fp.placements.length} devices from the bid’s kit: ${sam} placed by code beside an object SAM 3.1 found (filled), ${fp.placements.length - sam} estimated by Muse Spark where no object fit (outlined). Hover or tap a number for the SKU.`;
    for (const b of document.querySelectorAll('.tr-seg button')) b.setAttribute('aria-selected', String(b.dataset.layer === name));
  };
  for (const b of document.querySelectorAll('.tr-seg button')) b.addEventListener('click', () => layer(b.dataset.layer));
  layer('devices');
}
