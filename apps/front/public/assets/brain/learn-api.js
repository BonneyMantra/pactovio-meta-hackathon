// Readers for the onboarding + learning endpoints (apps/api/src/routes/brain.ts), normalised for the views.
import { api } from '../ui.js';

const arr = (v) => (Array.isArray(v) ? v : []);
export const LEARN_MODEL = 'Muse Spark';

/** HubSpot products → Pactovio catalogue. Resolves when every product (and its image) is stored. */
export const hubspotSync = () => api('/brain/hubspot/sync', { method: 'POST', body: {}, signal: AbortSignal.timeout(180000) });

/** Catalogue products that came from HubSpot, newest state of each. */
export async function hubspotProducts() {
  const { items = [] } = await api('/products');
  return items.filter((p) => p?.specs?.source === 'hubspot');
}

export async function driveFolders() {
  const r = await api('/brain/drive/folders');
  return arr(r.folders || r.items);
}

export const startLearn = (folder) => api('/brain/drive/learn', { method: 'POST', body: { folderId: folder.id, folderName: folder.name } });

const RUN_STATUS = { running: 'running', completed: 'done', failed: 'failed' };

function event(e) {
  const p = e.payload || {};
  const type = String(e.type || '').replace(/^brain\.learn\./, '');
  const f = p.facts && typeof p.facts === 'object' ? p.facts : {};
  return { ...f, seq: e.seq, type, at: e.at, file: p.filename, index: p.index, total: p.total, message: p.message, error: p.error, outcomes: p.outcomes, rules: p.rules, proposals: p.proposals };
}

/** { status: idle|running|done|failed, total, done, failed, folder, error, events[], last_seq } */
export async function learnProgress(after = 0) {
  const r = await api(`/brain/progress${after ? `?after=${after}` : ''}`);
  const run = r.run;
  if (!run) return { status: 'idle', total: 0, done: 0, failed: 0, folder: null, error: null, events: [], last_seq: 0 };
  return {
    status: RUN_STATUS[run.status] || 'running', total: run.total ?? 0, done: run.done ?? 0, failed: run.failed ?? 0,
    folder: run.folder_name ? { id: run.folder_id, name: run.folder_name } : null, error: run.error || null,
    events: arr(r.events).map(event), last_seq: r.last_seq ?? after,
  };
}

/** Real connection state per provider: connected | pending | available. */
export async function connectionState() {
  const { items = [] } = await api('/connectors').catch(() => ({ items: [] }));
  const of = (p) => items.find((x) => x.provider === p)?.status || 'available';
  return { hubspot: of('hubspot'), googledrive: of('googledrive') };
}

export async function connectProvider(provider, returnTo = '/app#/onboarding') {
  const r = await api(`/connectors/${encodeURIComponent(provider)}/connect`, { method: 'POST', signal: AbortSignal.timeout(30000), body: { redirect_to: returnTo } });
  return r?.redirect_url;
}
