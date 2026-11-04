// Onboarding step 2: connect HubSpot and watch the product catalogue stream in (POST/GET /api/brain/catalogue/import).
import { api, h, icon } from '../ui.js';
import { friendlyError, connectorDestination } from '../customer-api.js';
import { logoTile } from '../screens/ops-kit.js';
import { startCatalogueImport, catalogueImport } from '../brain-api.js';

const price = (p) => {
  if (p.unit_price_minor == null) return '';
  const v = p.unit_price_minor / 100;
  try { return new Intl.NumberFormat(p.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: p.currency || 'INR', maximumFractionDigits: 0 }).format(v); } catch { return `${p.currency} ${v}`; }
};
const thumb = (p) => p.image_url || (p.image_key ? `/api/products/${encodeURIComponent(p.id)}/image` : null);

export function catalogueStep(root, { connected, onNext, onSkip }) {
  let disposed = false, timer = null, tick = null;
  if (!connected) {
    const status = h('div.small.ink2', { role: 'status' });
    const btn = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
      btn.disabled = true; status.textContent = 'Opening HubSpot…';
      try { const r = await api('/connectors/hubspot/connect', { method: 'POST', signal: AbortSignal.timeout(30000), body: { redirect_to: '/app#/onboarding' } }); location.assign(connectorDestination(r?.redirect_url)); }
      catch (e) { status.textContent = friendlyError(e); btn.disabled = false; }
    } }, 'Connect HubSpot', icon('out', 15));
    root.replaceChildren(h('div.ob-card',
      h('div.access-step', 'STEP 2 · YOUR CATALOGUE'), h('h2.ob-h', 'Bring in your products'),
      h('p.ink2', 'Pactovio prices every proposal from your own catalogue. Connect HubSpot and it imports each product with its SKU, price and image.'),
      h('div.ob-connect', logoTile('hubspot', 44), h('div', h('strong', 'HubSpot'), h('div.small.ink2', 'Products library · read-only')), btn), status,
      h('div.ob-actions', h('button.btn.btn-ghost', { type: 'button', onclick: onSkip }, 'Skip for now'))));
    return () => { disposed = true; };
  }
  const grid = h('div.ob-products'), count = h('span.num', '0'), title = h('h2.ob-h', 'Importing your products');
  const next = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: onNext }, 'Continue', icon('arrow', 15));
  root.replaceChildren(h('div.ob-card.ob-wide',
    h('div.ob-headrow', h('div', h('div.access-step', 'STEP 2 · YOUR CATALOGUE'), title, h('p.ink2', 'From HubSpot, with prices and images, into your Pactovio catalogue.')),
      h('div.ob-count', count, h('span.muted', ' products'))),
    grid, h('div.ob-actions', h('span.small.ink2', 'You can edit prices and costs later in Catalogue.'), next)));
  const shown = new Set(), queue = [];
  const add = (p) => {
    const img = thumb(p);
    grid.prepend(h('div.ob-prod', h('span.ob-pimg', img ? h('img', { src: img, alt: '', onerror: (e) => e.target.remove() }) : null),
      h('div.ob-pname', p.name), h('div.ob-pmeta', h('span.mono', p.sku || ''), h('b.num', price(p)))));
    count.textContent = String(shown.size);
  };
  const play = () => {
    if (disposed) return;
    const p = queue.shift();
    if (p) add(p);
    tick = setTimeout(play, queue.length > 20 ? 30 : 75);
  };
  async function pull(first) {
    try {
      let s = await catalogueImport();
      if (first && s.status === 'idle' && !s.items.length) { await startCatalogueImport(); s = await catalogueImport(); }
      for (const p of s.items) { const k = p.id || p.sku; if (!shown.has(k)) { shown.add(k); queue.push(p); } }
      if (s.status === 'done' || s.status === 'failed') {
        const finish = () => { if (disposed) return; if (queue.length) { setTimeout(finish, 200); return; } title.textContent = s.status === 'failed' ? 'Import stopped early' : `${shown.size} products in your catalogue`; next.disabled = false; next.focus(); };
        return finish();
      }
    } catch (e) { if (!disposed && first) { grid.replaceChildren(h('div.error-box', friendlyError(e))); next.disabled = false; return; } }
    if (!disposed) timer = setTimeout(() => pull(false), 900);
  }
  pull(true); play();
  return () => { disposed = true; clearTimeout(timer); clearTimeout(tick); };
}
