import type { Env } from '@pactovio/contracts/env';

/** R2 keys for a proposal's files. The API serves them under GET /api/proposals/:id/assets/:name behind workspace auth. */
export const inputKey = (ws: string, id: string, filename: string): string => `proposals/${ws}/${id}/in/${filename.replace(/[^\w.\- ]/g, '_')}`;
export const assetKey = (ws: string, id: string, name: string): string => `proposals/${ws}/${id}/assets/${name}`;
export const assetName = (key: string): string => key.split('/assets/')[1] ?? key;

export async function putAsset(env: Pick<Env, 'FILES'>, key: string, bytes: Uint8Array, mime: string): Promise<void> {
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
}
