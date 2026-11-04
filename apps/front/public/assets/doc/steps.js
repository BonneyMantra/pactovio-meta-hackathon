// Run steps for the bid desk. The live list patches rows in place, so a step that finishes visibly ticks
// (the check pops in, the row flashes, its summary slides in) instead of the whole list being rebuilt.
import { h, icon } from '../ui.js';

export function modelClass(name = '') {
  return /wonder/i.test(name) ? 'wonder' : /sam/i.test(name) ? 'sam' : /image/i.test(name) ? 'image' : /spark/i.test(name) ? 'spark' : '';
}
export const modelChip = (name) => (name ? h(`span.pd-model.${modelClass(name)}`, name) : null);

/** Step summaries are written for the log; tidy them for the bid desk. */
const tidy = (t) => String(t).replace(/^skipped: /, 'Skipped: ').replace('file(s)', 'files');

const mark = (status) => (status === 'done' ? h('span.pd-tick', icon('check', 11))
  : status === 'failed' ? h('span.pd-tick.bad', icon('x', 11))
  : status === 'running' ? h('span.pd-spin') : h('span.pd-pend'));

function fill(el, s) {
  el.replaceChildren(...[mark(s.status),
    h('span', s.label || s.key, s.summary && s.status === 'done' ? h('span.pd-step-sum', tidy(s.summary)) : null),
    modelChip(s.model)].filter(Boolean));
}

/** Static list (the finished run in the rail). */
export function steps(items) {
  return h('div.pd-steps', (Array.isArray(items) ? items : []).map((s) => {
    const el = h(`div.pd-step.${s.status || 'pending'}`);
    fill(el, s);
    return el;
  }));
}

/** Live list: update(items) touches only rows whose status, model or summary changed. Returns the number done. */
export function liveSteps() {
  const el = h('div.pd-steps.live'), rows = new Map();
  function update(items) {
    for (const s of Array.isArray(items) ? items : []) {
      const key = s.key || s.label;
      let r = rows.get(key);
      if (!r) { r = { el: h('div.pd-step'), status: null, sig: '' }; rows.set(key, r); el.append(r.el); }
      const sig = `${s.status}|${s.model || ''}|${s.summary || ''}`;
      if (sig === r.sig) continue;
      // Only a change seen live ticks; steps already done when the page opened render quietly.
      const ticked = s.status === 'done' && r.status !== null && r.status !== 'done';
      r.el.className = `pd-step ${s.status || 'pending'}${ticked ? ' ticked' : ''}`;
      fill(r.el, s);
      r.status = s.status; r.sig = sig;
    }
    return [...rows.values()].filter((r) => r.status === 'done').length;
  }
  return { el, update };
}
