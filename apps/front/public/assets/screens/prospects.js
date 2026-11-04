// #/prospects — buyers with a public buying signal, found by Muse Spark web search, each with the page it came from and a
// drafted (never sent) first message. GET /api/prospects lists; POST /api/prospects/search runs a new search.
import { api, h, icon, fmt, toast, empty, errorBox, skeleton } from '../ui.js';
import { modelChip } from '../doc/rail.js';

/** SKUs are shown as chips below, so the bracketed codes the model cites inline are dropped from the sentence. */
const why = (t) => String(t || '').replace(/\s*\[[^\]]+\]/g, '').replace(/\s+([.,;:])/g, '$1')
  .replace(/,?\s+(?:fitting|matching|with|using|via|including|such as|like|for|e\.g\.)([.;:]|$)/gi, '$1').trim();
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** Draft body: the first "Subject:" line (if the model wrote one) becomes the subject. */
function splitDraft(text) {
  const m = /^\s*subject:\s*(.+)\n+/i.exec(text || '');
  return m ? { subject: m[1].trim(), body: text.slice(m[0].length).trim() } : { subject: '', body: (text || '').trim() };
}

function card(p, i) {
  const d = splitDraft(p.draft_outreach_email);
  const body = h('div.ps-draft', { hidden: i > 0 },
    h('div.ps-draft-head', h('span.chip.outline', icon('lock', 12), 'Draft only · never sent'), h('span.xs.muted', `To: ${p.org}`)),
    d.subject ? h('div.ps-subj', d.subject) : null, h('div.ps-body', d.body),
    h('div.ps-draft-foot', h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(p.draft_outreach_email); toast('Draft copied'); } catch { toast('Select the text to copy it'); }
    } }, icon('clip', 14), 'Copy draft')));
  const more = h('button.btn.btn-ghost.btn-sm', { type: 'button', 'aria-expanded': String(i === 0), onclick: () => { body.hidden = !body.hidden; more.setAttribute('aria-expanded', String(!body.hidden)); more.lastChild.textContent = body.hidden ? 'Show drafted message' : 'Hide draft'; } },
    icon('paper', 14), h('span', i === 0 ? 'Hide draft' : 'Show drafted message'));
  const products = (p.suggested_products || []).slice(0, 5);
  return h('article.card.ps', { style: { animationDelay: `${Math.min(i, 8) * 70}ms` } },
    h('div.ps-head', h('div.ps-id', h('div.ps-name', p.org),
      h('div.small.ink2', [p.country, p.published_at ? `signal from ${fmt.date(p.published_at)}` : null].filter(Boolean).join(' · ')))),
    h('div.ps-signal', h('div.ps-k', 'Buying signal'), h('p', p.signal),
      p.source_url ? h('a.xs.ps-src', { href: p.source_url, target: '_blank', rel: 'noopener' }, icon('out', 12), host(p.source_url)) : null),
    why(p.fit_reason) ? h('div.ps-why', icon('brain', 14), h('span', why(p.fit_reason))) : null,
    products.length ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, products.map((s) => h('span.chip.outline', s))) : null,
    h('div', more, body));
}

export async function render(root, _p, ctx) {
  ctx.setCrumbs('Prospects');
  const list = h('div.ps-list', skeleton(5));
  const meta = h('div.sub', 'Organisations with a public signal that they are about to buy what you sell. Every one links to the page it was found on.');
  const focus = h('input.input', { type: 'search', placeholder: 'Focus (optional), e.g. banks in Tamil Nadu expanding ATM networks', style: { flex: 1, minWidth: '220px' } });
  const go = h('button.btn.btn-primary', { type: 'submit' }, icon('search', 15), 'Find buyers');
  const status = h('div.small.ink2', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } });
  const form = h('form', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 8px' }, onsubmit: (e) => { e.preventDefault(); search(); } }, focus, go);
  root.append(h('div.page-head', h('div', h('h1.title', 'Prospects'), meta), h('a.btn.btn-secondary', { href: '#/tenders' }, icon('tender', 15), 'Open tenders')), form, status, list);

  let items = [];
  const draw = (fresh = new Set()) => {
    const sorted = [...items].sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id)) || String(b.created_at).localeCompare(String(a.created_at)));
    list.replaceChildren(...(sorted.length ? sorted.map(card)
      : [h('div.card', empty('No prospects yet', 'Run a search: Muse Spark reads the public web for budgets, expansions and procurement plans that match your catalogue.'))]));
  };
  async function search() {
    go.disabled = true; focus.disabled = true;
    status.replaceChildren(h('span.pd-spin'), 'Searching the public web with ', modelChip('Muse Spark'), '… this takes about a minute.');
    try {
      const r = await api('/prospects/search', { method: 'POST', body: focus.value.trim() ? { focus: focus.value.trim() } : {}, signal: AbortSignal.timeout(180000) });
      const got = r.prospects || [];
      const ids = new Set(got.map((p) => p.id));
      items = [...got, ...items.filter((p) => !ids.has(p.id))];
      status.replaceChildren(...[h('span', `${got.length} buyer${got.length === 1 ? '' : 's'} found with `), modelChip('Muse Spark'), h('span', ' web search'),
        r.dropped_without_source ? h('span.xs.muted', `· ${r.dropped_without_source} dropped with no verifiable source page`) : null].filter(Boolean));
      draw(ids);
    } catch (e) {
      status.replaceChildren(h('span', { style: { color: 'var(--bad)' } }, e.code === 'company_incomplete' ? 'Finish your company profile first.' : e.message));
    } finally { go.disabled = false; focus.disabled = false; }
  }
  try {
    items = (await api('/prospects')).items || [];
    if (items.length) status.replaceChildren(h('span', `${items.length} buyers found with `), modelChip('Muse Spark'), h('span', ` web search · last ${fmt.ago(items[0].created_at)}`));
    draw();
  } catch (e) { list.replaceChildren(errorBox(e)); }
}
