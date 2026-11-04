// Onboarding step 2: connect HubSpot and watch the product catalogue stream in.
// POST /api/brain/hubspot/sync does the import; /api/products is polled meanwhile so products (then images) appear as they land.
import { h, icon } from '../ui.js';
import { friendlyError, connectorDestination } from '../customer-api.js';
import { logoTile } from '../screens/ops-kit.js';
import { hubspotSync, hubspotProducts, connectProvider } from '../brain/learn-api.js';

const price = (p) => {
  if (p.unit_price_minor == null) return '';
  const v = p.unit_price_minor / 100;
  try { return new Intl.NumberFormat(p.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: p.currency || 'INR', maximumFractionDigits: 0 }).format(v); } catch { return `${p.currency} ${v}`; }
};
const thumbOf = (p) => p.image_url || null; // already versioned by the API

function connectCard(root, { onSkip, pending, error }) {
  const status = h('div.small.ink2', { role: 'status' }, error || (pending ? 'HubSpot did not finish connecting. Connect again to continue.' : ''));
  const btn = h('button.btn.btn-primary', { type: 'button', onclick: async () => {
    btn.disabled = true; status.textContent = 'Opening HubSpot…';
    try { location.assign(connectorDestination(await connectProvider('hubspot'))); }
    catch (e) { status.textContent = friendlyError(e); btn.disabled = false; }
  } }, pending ? 'Reconnect HubSpot' : 'Connect HubSpot', icon('out', 15));
  root.replaceChildren(h('div.ob-card',
    h('div.access-step', 'STEP 2 · YOUR CATALOGUE'), h('h2.ob-h', 'Bring in your products'),
    h('p.ink2', 'Pactovio prices every proposal from your own catalogue. Connect HubSpot and it imports each product with its SKU, price and image.'),
    h('div.ob-connect', logoTile('hubspot', 44), h('div', h('strong', 'HubSpot'), h('div.small.ink2', 'Products and deals · read-only')), btn), status,
    h('div.ob-actions', h('button.btn.btn-ghost', { type: 'button', onclick: onSkip }, 'Skip for now'))));
  btn.focus();
}

export function catalogueStep(root, { connection, onNext, onSkip }) {
  let disposed = false, timer = null, tick = null, syncing = true;
  if (connection !== 'connected') { connectCard(root, { onSkip, pending: connection === 'pending' }); return () => { disposed = true; }; }

  const grid = h('div.ob-products'), count = h('span.num', '0'), title = h('h2.ob-h', 'Importing your products');
  const sub = h('p.ink2', 'Reading the HubSpot products library: SKU, price and image for each product.');
  const status = h('span.small.ink2', { role: 'status', 'aria-live': 'polite' }, 'Connected to HubSpot');
  const next = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: onNext }, 'Continue', icon('arrow', 15));
  root.replaceChildren(h('div.ob-card.ob-wide',
    h('div.ob-headrow', h('div', h('div.access-step', 'STEP 2 · YOUR CATALOGUE'), title, sub), h('div.ob-count', count, h('span.muted', ' products'))),
    grid, h('div.ob-actions', status, next)));

  const tiles = new Map(), queue = [];
  const setImg = (tile, p) => {
    const src = thumbOf(p);
    if (!src || tile.dataset.src === src) return;
    tile.dataset.src = src;
    const img = h('img', { src, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() });
    tile.querySelector('.ob-pimg').replaceChildren(img);
  };
  const add = (p) => {
    const tile = h('div.ob-prod', h('span.ob-pimg'), h('div.ob-pname', p.name), h('div.ob-pmeta', h('span.mono', p.sku || ''), h('b.num', price(p))));
    tiles.set(p.id, tile); setImg(tile, p); grid.prepend(tile);
    count.textContent = String(tiles.size);
  };
  const play = () => {
    if (disposed) return;
    const p = queue.shift();
    if (p) add(p);
    tick = setTimeout(play, queue.length > 20 ? 35 : 80);
  };
  const queued = new Set();
  async function poll() {
    try {
      for (const p of await hubspotProducts()) {
        if (tiles.has(p.id)) setImg(tiles.get(p.id), p);
        else if (!queued.has(p.id)) { queued.add(p.id); queue.push(p); }
      }
    } catch { /* transient; the sync result decides */ }
    if (!disposed && syncing) timer = setTimeout(poll, 900);
  }
  const finish = (r) => {
    if (disposed) return;
    if (queue.length) { tick = setTimeout(() => finish(r), 250); return; }
    const n = tiles.size;
    title.textContent = n ? `${n} products in your catalogue` : 'No products found in HubSpot';
    sub.textContent = n ? 'Imported from HubSpot with prices and images. Every proposal is priced from these.' : 'Add products to the HubSpot products library, or skip and add them in Catalogue.';
    const imgs = r?.images_fetched ? ` · ${r.images_fetched} product images` : '';
    status.textContent = n ? `From HubSpot${imgs}. You can edit prices and costs later in Catalogue.` : '';
    next.disabled = false; next.focus();
  };
  play(); poll();
  hubspotSync().then(async (r) => { syncing = false; clearTimeout(timer); await poll(); finish(r); }).catch((e) => {
    syncing = false; clearTimeout(timer);
    if (disposed) return;
    if (e.code === 'not_connected') return connectCard(root, { onSkip, pending: true });
    if (tiles.size || queue.length) return finish(null);
    grid.replaceChildren(h('div.error-box', friendlyError(e), h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: () => catalogueStep(root, { connection, onNext, onSkip }) }, 'Try again')));
    next.textContent = 'Skip for now'; next.onclick = onSkip; next.disabled = false;
  });
  return () => { disposed = true; clearTimeout(timer); clearTimeout(tick); };
}
