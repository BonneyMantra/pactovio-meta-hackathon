// Onboarding step 2: connect HubSpot and watch the product catalogue stream into the working panel.
// POST /api/brain/hubspot/sync does the import; /api/products is polled meanwhile so products appear as their photos land.
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
const spin = () => h('span.pv-spin', { 'aria-hidden': 'true' });

function connectCard(s, { nav, onSkip, pending, error }) {
  s.work(null);
  const status = h('p.pv-status', { role: 'status' }, error || (pending ? 'HubSpot did not finish connecting. Connect again to continue.' : ''));
  const btn = h('button.pv-btn', { type: 'button', onclick: async () => {
    btn.disabled = true; btn.replaceChildren(spin(), 'Opening HubSpot…'); status.textContent = '';
    try { location.assign(connectorDestination(await connectProvider('hubspot'))); }
    catch (e) { status.textContent = friendlyError(e); status.className = 'pv-status pv-error'; btn.disabled = false; btn.replaceChildren(label, icon('out', 15)); }
  } });
  const label = pending ? 'Reconnect HubSpot' : 'Connect HubSpot';
  btn.append(label, icon('out', 15));
  s.ask(nav, h('div.pv-heading', h('h1', { tabindex: '-1' }, 'Bring in your products'),
    h('p.pv-lede', 'Pactovio prices every proposal from your own catalogue. Connect HubSpot and it imports each product with its SKU, price and image.')),
  h('div.pv-form', h('div.pv-source', logoTile('hubspot', 40), h('div', h('strong', 'HubSpot'), h('span', 'Products, prices and deal outcomes'))), status, btn,
    h('button.pv-link.pv-link-mute.pv-resend', { type: 'button', onclick: onSkip }, 'Skip for now')));
  btn.focus({ preventScroll: true });
}

export function catalogueStep(s, { nav, connection, onNext, onSkip }) {
  let disposed = false, timer = null, tick = null, syncing = true;
  if (connection !== 'connected') { connectCard(s, { nav, onSkip, pending: connection === 'pending' }); return () => { disposed = true; }; }

  const grid = h('div.ob-products'), count = h('span.num', '0');
  const title = h('h1', { tabindex: '-1' }, 'Importing your catalogue');
  const sub = h('p.pv-lede', 'Reading the HubSpot products library: SKU, price and image for each product.');
  const status = h('p.pv-status', { role: 'status', 'aria-live': 'polite' }, 'Connected to HubSpot');
  const next = h('button.pv-btn', { type: 'button', disabled: true, onclick: onNext }, spin(), 'Importing…');
  const live = h('span.pv-live', h('i'), 'Live');
  const after = h('div.pv-form.pv-after', status, next);
  s.ask(nav, h('div.pv-heading', title, sub), h('div.pv-bigcount', count, h('span', 'catalogue items')), after);
  s.work(h('div.pv-panel', h('div.pv-panel-head', h('div', h('div.pv-kicker', 'HubSpot · Products library'), h('h2', 'Your catalogue')), live), grid));

  const tiles = new Map(), queue = [];
  const setImg = (tile, p) => {
    const src = thumbOf(p);
    if (!src || tile.dataset.src === src) return;
    tile.dataset.src = src;
    const img = h('img', { src, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() });
    tile.querySelector('.ob-pimg').replaceChildren(img);
  };
  const add = (p) => {
    const tile = h('div.ob-prod', h('span.ob-pimg', h('span.ob-noimg', icon('box', 22))), h('div.ob-pname', p.name), h('div.ob-pmeta', h('span.mono', p.sku || ''), h('b.num', price(p))));
    // Photographed products stream in at the top; items without a photo (services, parts) go below them.
    tiles.set(p.id, tile); setImg(tile, p);
    if (thumbOf(p)) grid.prepend(tile); else grid.append(tile);
    count.textContent = String(tiles.size);
  };
  const play = () => {
    if (disposed) return;
    const p = queue.shift();
    if (p) add(p);
    tick = setTimeout(play, queue.length > 20 ? 35 : 80);
  };
  // Rows land before their photos (images are fetched after the insert), so a product is shown once its photo is in;
  // the ones still without a photo when the import ends follow after.
  // A photo is decoded before its tile is added, so a tile never lands with a half-painted image.
  const queued = new Set(), held = new Map();
  let decoding = 0, waits = 0;
  const ready = (p) => {
    queued.add(p.id); decoding++;
    const im = new Image(); im.src = thumbOf(p);
    im.decode().catch(() => undefined).finally(() => { decoding--; if (!disposed) queue.push(p); });
  };
  const flush = () => { for (const [id, p] of held) { queued.add(id); queue.push(p); } held.clear(); };
  async function poll() {
    try {
      for (const p of await hubspotProducts()) {
        if (tiles.has(p.id)) setImg(tiles.get(p.id), p);
        else if (queued.has(p.id)) continue;
        else if (thumbOf(p)) { held.delete(p.id); ready(p); }
        else held.set(p.id, p);
      }
    } catch { /* transient; the sync result decides */ }
    if (!disposed && syncing) timer = setTimeout(poll, 900);
  }
  const finish = (r) => {
    if (disposed) return;
    if (queue.length || (decoding && waits++ < 32)) { tick = setTimeout(() => finish(r), 250); return; }
    const n = tiles.size;
    title.textContent = n ? 'Catalogue imported' : 'No products found in HubSpot';
    sub.textContent = n ? 'Imported from HubSpot with prices and images. Every proposal is priced from these.' : 'Add products to the HubSpot products library, or skip and add them in Catalogue.';
    const imgs = r?.images_fetched ? ` · ${r.images_fetched} product images` : '';
    status.textContent = n ? `Priced from HubSpot${imgs}. Products, parts and services; edit prices and costs later in Catalogue.` : '';
    live.replaceChildren(icon('check', 13), 'Imported'); live.className = 'pv-tag-ok';
    next.replaceChildren('Continue', icon('arrow', 16)); next.disabled = false; next.focus({ preventScroll: true });
  };
  play(); poll();
  hubspotSync().then(async (r) => { syncing = false; clearTimeout(timer); await poll(); flush(); finish(r); }).catch((e) => {
    syncing = false; clearTimeout(timer);
    if (disposed) return;
    if (e.code === 'not_connected') return connectCard(s, { nav, onSkip, pending: true });
    flush();
    if (tiles.size || queue.length || decoding) return finish(null);
    title.textContent = 'The import stopped';
    status.textContent = friendlyError(e); status.className = 'pv-status pv-error';
    next.replaceChildren('Try again', icon('refresh', 16)); next.disabled = false;
    next.onclick = () => { disposed = true; clearTimeout(tick); catalogueStep(s, { nav, connection, onNext, onSkip }); };
    after.append(h('button.pv-link.pv-link-mute.pv-resend', { type: 'button', onclick: onSkip }, 'Skip for now'));
  });
  return () => { disposed = true; clearTimeout(timer); clearTimeout(tick); };
}
