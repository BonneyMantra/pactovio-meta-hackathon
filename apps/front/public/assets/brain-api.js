// One place for the Meta-hackathon endpoints (Company Brain, proposals, voice, autopilot, prospects).
// Every reader tolerates small shape differences so the backend can evolve without UI breakage.
import { api } from './ui.js';

const arr = (v) => (Array.isArray(v) ? v : []);

/** Catalogue lookup by SKU: { id, name, thumb } — thumbnails come from the product image route. */
export async function productIndex() {
  const map = new Map();
  try {
    const { items = [] } = await api('/products');
    for (const p of items) {
      if (!p?.sku) continue;
      const thumb = p.image_url || (p.image_key ? `/api/products/${encodeURIComponent(p.id)}/image` : null);
      map.set(p.sku, { id: p.id, name: p.name, thumb, price_minor: p.unit_price_minor, currency: p.currency, family: p.family });
    }
  } catch { /* thumbnails and names are decoration */ }
  return map;
}

export const getBrain = () => api('/brain');
export const brainProposals = async () => arr((await api('/brain/proposals')).items);

/** HubSpot → catalogue import. */
export const startCatalogueImport = () => api('/brain/catalogue/import', { method: 'POST', body: {} });
export async function catalogueImport() {
  const r = await api('/brain/catalogue/import');
  return { status: r.status || 'idle', total: r.total ?? null, imported: r.imported ?? arr(r.items).length, items: arr(r.items) };
}

/** Drive folder pick + learning job. */
export const driveFolders = async () => arr((await api('/brain/drive/folders')).items);
export const startIngest = (folder) => api('/brain/ingest', { method: 'POST', body: { folder_id: folder.id, folder_name: folder.name } });
/** { status: idle|running|done|failed, total, done, failed, events: [{ seq, type, file, ref, title, client, … }] } */
export async function ingestState(after = 0) {
  const r = await api(`/brain/ingest${after ? `?after=${after}` : ''}`);
  return { status: r.status || 'idle', total: r.total ?? 0, done: r.done ?? 0, failed: r.failed ?? 0, folder: r.folder || null, events: arr(r.events) };
}

/** Proposal runs. `file` is the RFQ; extras (floor plans, drawings) ride along. */
export async function startProposal({ file, extras = [], text = '', threadId }) {
  const form = new FormData();
  if (file) form.append('file', file, file.name);
  for (const f of extras) form.append('attachments', f, f.name);
  if (text) form.append('text', text);
  if (threadId) form.append('thread_id', threadId);
  return api('/proposals', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
}
export const getProposal = (id) => api(`/proposals/${encodeURIComponent(id)}`);
export const listProposals = async () => arr((await api('/proposals')).items);

/** 16 kHz mono WAV → { text }. */
export async function transcribe(wav) {
  const r = await api('/voice/transcribe', { method: 'POST', body: wav, headers: { accept: 'application/json', 'content-type': 'audio/wav' } });
  return { text: r.text || r.transcript || '', model: r.model || null };
}

export const autopilot = () => api('/autopilot');
export const prospects = () => api('/prospects');
