// #/prospects — buyers with public buying signals, ranked against the Company Brain, each with a drafted
// (never sent) first message. GET /api/prospects.
import { h, icon, fmt, toast, empty, errorBox, skeleton } from '../ui.js';
import { prospects } from '../brain-api.js';
import { fitRing } from './work-kit.js';
import { modelChip } from '../doc/rail.js';

const country = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code); } catch { return code; } };

function card(p, i) {
  const o = p.outreach || {};
  const body = h('div.ps-draft', { hidden: i > 0 },
    h('div.ps-draft-head', h('span.chip.outline', icon('lock', 12), 'Draft only · not sent'), o.to_role ? h('span.xs.muted', `To: ${o.to_role}`) : null),
    h('div.ps-subj', o.subject || ''), h('div.ps-body', o.body || ''),
    h('div.ps-draft-foot', h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(`Subject: ${o.subject || ''}\n\n${o.body || ''}`); toast('Draft copied'); } catch { toast('Select the text to copy it'); }
    } }, icon('clip', 14), 'Copy draft')));
  const more = h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-expanded': String(i === 0), onclick: () => { body.hidden = !body.hidden; more.setAttribute('aria-expanded', String(!body.hidden)); more.lastChild.textContent = body.hidden ? 'Show drafted message' : 'Hide draft'; } },
    icon('paper', 14), h('span', i === 0 ? 'Hide draft' : 'Show drafted message'));
  return h('article.card.ps', { style: { animationDelay: `${i * 80}ms` } },
    h('div.ps-head', fitRing(p.fit, 46),
      h('div.ps-id', h('div.ps-name', p.company), h('div.small.ink2', [p.sector, [p.city, country(p.country)].filter(Boolean).join(', ')].filter(Boolean).join(' · ')))),
    h('div.ps-signal', h('div.ps-k', 'Buying signal'), h('p', p.signal),
      p.signal_url ? h('a.xs.ps-src', { href: p.signal_url, target: '_blank', rel: 'noopener' }, icon('out', 12), new URL(p.signal_url).hostname.replace(/^www\./, '')) : null),
    p.why ? h('div.ps-why', icon('brain', 14), h('span', p.why)) : null,
    o.subject || o.body ? h('div', more, body) : null);
}

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Prospects');
  const list = h('div.ps-list', skeleton(5));
  const meta = h('div.sub');
  root.append(h('div.page-head', h('div', h('h1.title', 'Prospects'), meta), h('a.btn.btn-secondary', { href: '#/tenders' }, icon('tender', 15), 'Open tenders')), list);
  meta.textContent = 'Buyers with a public signal that they are about to buy what you sell, ranked against your Company Brain.';
  try {
    const r = await prospects();
    const items = (r.items || []).slice().sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
    if (r.model || r.generated_at) meta.append(h('div.ps-meta', r.model ? h('span', 'Found with web search on ', modelChip(r.model)) : null, r.generated_at ? h('span.xs.muted', `Updated ${fmt.ago(r.generated_at)}`) : null));
    list.replaceChildren(...(items.length ? items.map(card) : [h('div.card', empty('No prospects yet', 'Pactovio searches the public web for buyers with tenders, budgets or hiring that match what you sell.'))]));
  } catch (e) { list.replaceChildren(errorBox(e)); }
}
