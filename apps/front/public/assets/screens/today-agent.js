// Home hero: the company's agent greets the user, says what it knows (GET /api/brain) and takes an RFQ
// straight into a proposal run (POST /api/proposals), then opens the live proposal.
import { h, icon, toast } from '../ui.js';
import { startProposal } from '../brain-api.js';
import { inrShort } from '../doc/kit.js';
import { agentAvatar, firstName, knowledge, possessive, shortName } from '../agent-id.js';

const ACCEPT = '.pdf,.docx,.txt,.eml,.png,.jpg,.jpeg,.webp';
const MAX_FILES = 6;

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

function intro(company, k) {
  if (k.learned) return `I’ve read ${company}’s ${k.learned} past proposals and know your ${k.products} products at your own prices. Send me an RFQ and I’ll write the proposal the way ${company} does: your structure, your voice, your terms.`;
  if (k.products) return `I know ${company}’s ${k.products} products and prices. Point me at your past proposals in Google Drive and I’ll learn how ${company} writes and wins.`;
  return `I’m ${possessive(company)} bid agent. Connect your CRM and your past proposals and I’ll learn what you sell, how you price it and how you write.`;
}

function fact(v, label, href) {
  return h('a.ag-fact', { href }, h('b.num', v), h('span', label));
}

/** The drop-an-RFQ composer. Files and optional notes go to the real proposal run. */
function composer(company) {
  const files = [];
  const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  const list = h('div.ag-files');
  const ta = h('textarea.ag-ta', { rows: '2', placeholder: `Or describe the request: "120 ATMs and 18 branches, e-surveillance, Chennai circle"…`, 'aria-label': 'Describe the request' });
  const go = h('button.btn.btn-primary.ag-go', { type: 'button' }, icon('spark', 15), 'Write the proposal');
  const drop = h('div.ag-drop', { tabindex: '0', role: 'button', 'aria-label': 'Add RFQ files' },
    h('span.ag-drop-ico', icon('clip', 18)),
    h('div', h('div.ag-drop-t', 'Drop the RFQ, tender pack or floor plan'), h('div.xs.muted', 'PDF, Word, email or drawing · up to 6 files · 15 MB each')),
    h('span.btn.btn-secondary.btn-sm.ag-pick', 'Choose files'));

  function draw() {
    list.replaceChildren(...files.map((f, i) => h('span.ag-file', icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? 'image' : 'file', 13), h('span.ag-fname', f.name),
      h('button', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); draw(); } }, icon('x', 12)))));
    go.disabled = !files.length && !ta.value.trim();
  }
  function add(fs) {
    for (const f of fs) {
      if (files.length >= MAX_FILES) { toast(`At most ${MAX_FILES} files per proposal`); break; }
      if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is larger than 15 MB`); continue; }
      if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
    }
    draw();
  }
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); add([...(e.dataTransfer?.files || [])]); });
  ta.addEventListener('input', draw);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go.click(); });
  go.addEventListener('click', async () => {
    if (go.disabled) return;
    go.disabled = true; go.replaceChildren(h('span.pd-spin'), 'Starting…');
    try {
      const r = await startProposal({ files, text: ta.value.trim() });
      const id = r.proposalId || r.id;
      if (!id) throw new Error('The run did not start');
      location.hash = `#/proposals/${encodeURIComponent(id)}`;
    } catch (e) {
      toast(e.message || 'Could not start the proposal');
      go.replaceChildren(icon('spark', 15), 'Write the proposal'); draw();
    }
  });
  draw();
  return h('div.ag-comp', input, drop, list, h('div.ag-comp-foot', ta,
    h('div.ag-comp-act', go, h('a.btn.btn-ghost.btn-sm', { href: '#/agent' }, icon('agent', 15), 'Ask a question instead'))),
  h('div.xs.muted.ag-comp-note', icon('check', 12), `Drafts only. Nothing leaves ${company} until you send it.`));
}

/** What the next proposal will apply: the learned house style, compact. */
function stylePanel(company, k) {
  const st = k.style;
  if (!st) {
    const learn = ['Section order', 'Voice and phrasing', 'Payment terms', 'Warranty and AMC', 'Discount pattern', 'Win rate by sector'];
    return h('aside.card.ag-style.ag-style-empty', h('div.bs-k', 'House style'),
      h('p.small.ink2', `Point me at ${company}’s past proposals in Google Drive and I’ll learn:`),
      h('ol.ag-order.ghost', learn.map((s, i) => h('li', h('span.num', String(i + 1).padStart(2, '0')), s))),
      h('a.btn.btn-secondary.btn-sm', { href: '#/brain/learning' }, icon('refresh', 14), 'Teach me from Drive'));
  }
  const order = st.section_order || [];
  const rule = (st.voice_rules || [])[0];
  return h('aside.card.ag-style',
    h('div.ag-style-head', h('div.bs-k', 'House style I’ll apply'), h('a.xs.muted', { href: '#/brain' }, 'Brain', icon('chev', 12))),
    h('ol.ag-order', order.map((s, i) => h('li', { style: { animationDelay: `${i * 35}ms` } }, h('span.num', String(i + 1).padStart(2, '0')), s))),
    rule ? h('div.ag-rule', h('b', rule.id), h('span', rule.text)) : null,
    h('dl.ag-terms',
      st.payment_terms ? h('div', h('dt', 'Payment'), h('dd', st.payment_terms)) : null,
      st.validity_days ? h('div', h('dt', 'Validity'), h('dd', `${st.validity_days} days`)) : null,
      st.amc_pct != null ? h('div', h('dt', 'AMC'), h('dd', `${st.amc_pct}% of hardware per year`)) : null));
}

export function agentHero(ctx) {
  const company = shortName(ctx.session?.workspace?.name);
  const k = knowledge(ctx.brain);
  const name = firstName(ctx);
  const facts = k.learned ? [
    fact(String(k.learned), 'proposals learned', '#/brain'),
    k.winRate != null ? fact(`${k.winRate}%`, `win rate · ${k.won} won, ${k.lost} lost`, '#/brain') : null,
    k.median ? fact(inrShort(k.median), 'median deal', '#/brain') : null,
    fact(String(k.products), 'products priced', '#/catalogue'),
  ] : [fact(String(k.products), 'products priced', '#/catalogue'), fact('0', 'proposals learned', '#/brain/learning')];
  return h('section.ag-hero',
    h('div.ag-main',
      h('div.ag-who', agentAvatar(ctx.session?.workspace?.name, 36),
        h('div', h('div.ag-who-t', `${possessive(company)} agent`), h('div.xs.muted', k.learnedAt ? `Up to date · learned ${new Date(k.learnedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Getting to know your company'))),
      h('h1.ag-hello', `${greeting()}${name ? `, ${name}` : ''}.`),
      h('p.ag-intro', intro(company, k)),
      h('div.ag-facts', facts),
      composer(company)),
    stylePanel(company, k));
}
