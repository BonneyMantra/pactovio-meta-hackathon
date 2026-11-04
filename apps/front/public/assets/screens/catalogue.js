// #/catalogue — the products the agent quotes from (GET /api/products, imported from HubSpot).
// A searchable grid with images and selling prices; internal costs stay private and are edited in place.
import { api, h, icon, empty } from '../ui.js';
import { friendlyError } from '../customer-api.js';
import { catalogueForm } from '../catalogue-form.js';
import { inr } from '../doc/kit.js';
import { possessive, shortName } from '../agent-id.js';

const KIND = { own: ['Own product', 'own'], external: ['Third-party', 'ext'], service: ['Service', 'svc'] };
function kindOf(p) {
  const t = String(p.specs?.type || '').toLowerCase();
  if (t.includes('service') || /^SVC-|^SRV-/i.test(p.sku) || /service|installation/i.test(p.family || '')) return 'service';
  if (t === 'external' || /^EXT-/i.test(p.sku)) return 'external';
  return 'own';
}
const priceOf = (p) => (Number.isSafeInteger(p.unit_price_minor) ? p.unit_price_minor / 100 : null);
const money = (p) => { const v = priceOf(p); if (v == null) return 'Price needed'; return p.currency === 'INR' || !p.currency ? inr(v) : `${p.currency} ${v.toLocaleString('en-IN')}`; };
const unitOf = (p) => String(p.specs?.unit || p.unit || 'each').replace(/^per /, '');
const RANK = { own: 0, external: 1, service: 2 };
/** Own products with photos first, then the rest of the own range, third-party items and services. */
const order = (a, b) => (RANK[kindOf(a)] - RANK[kindOf(b)]) || ((b.image_url ? 1 : 0) - (a.image_url ? 1 : 0)) || String(a.family).localeCompare(String(b.family)) || a.name.localeCompare(b.name);

function productCard(p, onEdit) {
  const [kind, cls] = KIND[kindOf(p)];
  const img = p.image_url || null;
  return h('article.ct-card',
    h('div.ct-img', img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span.ct-noimg', { title: 'No product photo published' }, icon(kindOf(p) === 'service' ? 'settings' : 'box', 30))),
    h('div.ct-body',
      h('div.ct-tags', h(`span.ct-kind.${cls}`, kind), p.family ? h('span.xs.muted', p.family) : null),
      h('div.ct-name', p.name),
      p.description || p.specs?.description ? h('div.xs.ink2.ct-desc', p.description || p.specs.description) : null),
    h('div.ct-foot',
      h('div', h('div.ct-price.num', money(p)), h('div.xs.muted', unitOf(p) === 'each' ? 'each' : `per ${unitOf(p)}`)),
      h('div.ct-side', h('span.mono.xs.muted', p.sku),
        h('button.ct-edit', { type: 'button', 'aria-label': `Edit ${p.name}`, title: p.internal_unit_cost_minor == null ? 'Add the private internal cost' : 'Edit product', onclick: () => onEdit(p) },
          p.internal_unit_cost_minor == null ? 'Add cost' : 'Edit'))));
}

export async function render(root, _params, ctx) {
  ctx.setCrumbs('Catalogue');
  root.classList.add('ct-page');
  const company = shortName(ctx.session?.workspace?.name);
  const grid = h('div.ct-grid'), editor = h('div.card.company-settings', { hidden: true });
  const families = h('div.ct-fams', { role: 'tablist', 'aria-label': 'Filter by family' });
  const search = h('input.ct-search', { type: 'search', placeholder: 'Search products, SKUs or families', 'aria-label': 'Search the catalogue' });
  const count = h('div.xs.muted');
  const add = h('button.btn.btn-secondary', { type: 'button', onclick: () => edit() }, icon('box', 15), 'Add product');
  const sub = h('div.sub', 'Loading the catalogue…');
  root.append(h('div.page-head', h('div', h('div.access-step', 'WHAT IT KNOWS'), h('h1.title', `${possessive(company)} catalogue`), sub), add),
    editor, h('div.ct-bar', h('label.ct-searchwrap', icon('search', 15), search), families), count, grid);
  let items = [], fam = 'All', disposed = false;

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((p) => (fam === 'All' || p.family === fam) && (!q || `${p.name} ${p.sku} ${p.family} ${p.description || ''}`.toLowerCase().includes(q)));
    count.textContent = shown.length === items.length ? `${items.length} products` : `${shown.length} of ${items.length} products`;
    grid.replaceChildren(...(shown.length ? shown.map((p) => productCard(p, edit)) : [h('div.card.ct-none', empty('Nothing matches', 'Try another word, or clear the filter.'))]));
  }
  function drawFamilies() {
    const counts = new Map();
    for (const p of items) if (p.family) counts.set(p.family, (counts.get(p.family) || 0) + 1);
    const list = [['All', items.length], ...[...counts.entries()].sort((a, b) => b[1] - a[1])];
    families.replaceChildren(...list.map(([f, n]) => h(`button.ct-fam${f === fam ? '.on' : ''}`, { type: 'button', role: 'tab', 'aria-selected': String(f === fam), onclick: () => { fam = f; drawFamilies(); draw(); } }, f, h('span', String(n)))));
  }
  async function loadList() {
    grid.replaceChildren(...Array.from({ length: 8 }, () => h('div.ct-card.ct-skel', h('div.skeleton', { style: { height: '100%' } }))));
    try {
      items = ((await api('/products')).items || []).sort(order);
      if (disposed) return;
      if (!items.length) {
        sub.textContent = 'Connect HubSpot to import your products and prices, or add them by hand.';
        grid.replaceChildren(h('div.card.ct-none', empty('Your catalogue starts here', 'I price every proposal from these products, so start with what you sell.', h('a.btn.btn-primary', { href: '#/connections' }, 'Connect HubSpot'))));
        return;
      }
      const own = items.filter((p) => kindOf(p) === 'own').length;
      const fromHub = items.some((p) => p.specs?.source === 'hubspot' || p.specs?.hubspot_id);
      sub.textContent = `${items.length} products${fromHub ? ' imported from HubSpot' : ''} · ${own} made by ${company}. I price every proposal from these, at your selling prices.`;
      drawFamilies(); draw();
    } catch (e) { if (!disposed) grid.replaceChildren(h('div.error-box', friendlyError(e)), h('button.btn.btn-secondary', { onclick: loadList }, 'Retry catalogue')); }
  }
  function close() { editor.hidden = true; editor.replaceChildren(); add.disabled = false; }
  function edit(product) {
    add.disabled = true; editor.hidden = false;
    editor.replaceChildren(catalogueForm(product, async () => { if (disposed) return; close(); await loadList(); }, close));
    editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editor.querySelector('input')?.focus({ preventScroll: true });
  }
  search.addEventListener('input', draw);
  await loadList();
  return () => { disposed = true; };
}
