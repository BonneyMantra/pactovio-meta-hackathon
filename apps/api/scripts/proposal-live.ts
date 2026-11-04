// Live end-to-end run of the proposal pipeline on real Meta models (costs ~$0.15-0.30).
// Usage: set -a; . ./.env.local; set +a; META_API_KEY=$PACTOVIO_META_MODEL_API_KEY LIVE_PROPOSAL='<rfq-dir>|<catalogue.csv>|<out-dir>' npx tsx apps/api/scripts/proposal-live.ts
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProposal, inputKey, listSteps, loadProposalJson, renderProposalHtml, runProposal, type InputFile } from '@pactovio/proposal';
import { customerFixture } from '../test/customer-fixture';
import { localStorageEnv } from '../test/local-storage';


const LIVE = process.env.LIVE_PROPOSAL;
const [rfqDir, csvPath, outDir] = (LIVE ?? '||').split('|') as [string, string, string];
mkdirSync(outDir, { recursive: true });
const { env, dispose } = localStorageEnv();
const sql = readdirSync(join(import.meta.dirname, '../migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(import.meta.dirname, '../migrations', f), 'utf8')).join('\n');
for (const st of sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await env.DB.prepare(st).run();
Object.assign(env, { MODEL_DAILY_CAP_USD: '5', ENVIRONMENT: 'development' });
env.META_API_KEY = process.env.META_API_KEY;
const ws = (await customerFixture(env)).workspace;

const parse = (s: string): string[][] => { const rows: string[][] = []; let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]!; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { cur.push(f); f = ''; } else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; } else if (c !== '\r') f += c; }
  return rows.filter((r) => r.length > 3); };
for (const [name, sku, desc, price, , , , cat] of parse(readFileSync(csvPath, 'utf8')).slice(1)) {
  await env.DB.prepare("INSERT OR REPLACE INTO products (id, workspace_id, sku, name, family, specs_json, unit_price_minor, currency) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR')")
    .bind(`prd_${sku}`, ws, sku, name, cat ?? null, JSON.stringify({ description: desc, unit: 'nos' }), Math.round(Number(price) * 100)).run();
}
const id = await createProposal(env, ws, { source: 'api', input: { files: [] } });
const files: InputFile[] = [];
for (const f of readdirSync(rfqDir).filter((n) => /\.(pdf|png|jpe?g|txt)$/i.test(n) && !/marketing|other|prompt|README/i.test(n))) {
  const bytes = readFileSync(join(rfqDir, f)); const key = inputKey(ws, id, f);
  const mime = f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.png') ? 'image/png' : 'text/plain';
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } }); files.push({ key, filename: f, mime, size: bytes.length });
}
await env.DB.prepare('UPDATE proposals SET input_json = ? WHERE id = ?').bind(JSON.stringify({ files }), id).run();
const t0 = Date.now();
const tick = setInterval(async () => { const r = await listSteps(env, ws, id); process.stderr.write(`[${Math.round((Date.now() - t0) / 1000)}s] ${r.map((x) => `${x.name}:${x.status}`).join(' ')}\n`); }, 15000);
await runProposal(env, { proposalId: id, workspaceId: ws });
clearInterval(tick);
const { proposal } = await loadProposalJson(env, ws, id);
const steps = await listSteps(env, ws, id);
writeFileSync(join(outDir, 'proposal.json'), JSON.stringify(proposal, null, 1));
writeFileSync(join(outDir, 'steps.json'), JSON.stringify(steps, null, 1));
if (proposal) writeFileSync(join(outDir, 'proposal.html'), renderProposalHtml(proposal, { seller: 'Rax Tech International', assetBase: 'assets' }));
for (const n of ['floorplan.png', 'floorplan.jpg', 'concept.jpg']) { const o = await env.FILES.get(`proposals/${ws}/${id}/assets/${n}`); if (o) writeFileSync(join(outDir, n), new Uint8Array(await o.arrayBuffer())); }
process.stdout.write(`${JSON.stringify({ id, wall_s: Math.round((Date.now() - t0) / 1000), status: proposal ? 'completed' : 'failed', steps: steps.map((s) => ({ n: s.name, st: s.status, ms: s.ms, usd: s.cost_usd, m: s.models, sum: s.summary })), total_usd: steps.filter((s) => s.name !== 'orchestrate').reduce((a, s) => a + s.cost_usd, 0) }, null, 1)}\n`);
await dispose();
