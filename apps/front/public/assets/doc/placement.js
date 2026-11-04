// Device placement figure: an image (client drawing or site visual) with the objects SAM 3.1 segmented and the devices anchored to them.
import { h } from '../ui.js';
import { list } from './kit.js';

export const TONE = (sku) => (/CCTV|CAM/.test(sku) ? 'cam' : /^RT-/.test(sku) ? 'rax' : 'ext');
const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;
const boxStyle = ([x, y, w, hh]) => ({ left: pct(x), top: pct(y), width: pct(w), height: pct(hh) });
const okBox = (b) => Array.isArray(b) && b.length === 4 && b.map(Number).every(Number.isFinite);
const isSam = (x) => /sam/i.test(x.source || '');

/** { placements, objects } → counts and a one-line lead naming what each model did. */
export function placementLead(src, where) {
  const pl = list(src?.placements).filter((x) => okBox(x.box));
  const samN = pl.filter(isSam).length, estN = pl.length - samN;
  if (samN) return ` SAM 3.1 segmented ${list(src.objects).length || 'the'} objects ${where}; ${samN} device${samN === 1 ? ' is' : 's are'} anchored to them${estN ? ` and ${estN} positioned by Muse Spark where no object fit` : ''}.`;
  return estN ? ` Positions were estimated by Muse Spark ${where}.` : '';
}

/**
 * src: { placements, objects }, img: URL. Returns [figure, legend list]. `start` offsets the pin numbers so two figures
 * in one document never reuse a number.
 */
export function placementFigure(c, src, img, { alt, caption, start = 0, wide = false } = {}) {
  const pl = list(src?.placements).filter((x) => okBox(x.box));
  const samN = pl.filter(isSam).length;
  const used = new Set(pl.map((x) => x.anchor).filter(Boolean));
  const objs = list(src?.objects).filter((o) => okBox(o.box) && used.has(o.what));
  const outlines = objs.map((o) => h('div.pd-obj', { style: boxStyle(o.box.map(Number)), title: `${o.what} · found by SAM 3.1` }));
  const marks = pl.map((x, i) => h(`div.pd-mark.${TONE(x.device_sku)}${isSam(x) ? '' : '.est'}`, { style: boxStyle(x.box.map(Number)), title: `${x.label} · ${x.device_sku}` }, h('span', String(start + i + 1))));
  const figure = h(`figure.pd-fig-block${wide ? '.pd-photo' : ''}`,
    h('div.pd-plan', h('img', { src: img, alt }), h('div.pd-marks', outlines, marks)),
    h('figcaption.pd-plan-key',
      caption ? h('span.pd-plan-cap', caption) : null,
      samN ? h('span', h('i.pd-key-obj'), 'Object found by SAM 3.1') : null,
      samN ? h('span', h('i.pd-key-dev'), 'Device anchored to it') : null,
      pl.length > samN ? h('span', h('i.pd-key-est'), 'Estimated position') : null));
  const legend = h('div.pd-place', pl.map((x, i) => h('div', h(`span.pd-dot.${TONE(x.device_sku)}`, String(start + i + 1)),
    h('div', h('div', x.label), h('div.pd-muted.pd-xs', c.nameOf(x.device_sku) || x.device_sku, ' · ', h('span.pd-mono', x.device_sku),
      x.anchor ? ` · at ${x.anchor}` : isSam(x) ? '' : ' · estimated')))));
  return [figure, legend, pl.length];
}
