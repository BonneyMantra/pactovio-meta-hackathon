// A/B: the same RFQ -> proposal pipeline orchestrated by Muse Wonder vs Muse Spark (live Meta models).
// Usage: META_API_KEY=... npx tsx scripts/evals/orchestrator-ab.ts --arm wonder|spark --out <dir> [--rfq <dir>] [--csv <file>]
// The spark arm answers any request for muse-wonder-1.0 with an instant 404 (no cost), so wonderLoop falls back to Spark on the same tools.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createProposal, inputKey, listSteps, loadProposalJson, runProposal, type InputFile } from '@pactovio/proposal';
import { customerFixture } from '../../apps/api/test/customer-fixture';
import { localStorageEnv } from '../../apps/api/test/local-storage';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const arm = arg('arm');
if (arm !== 'wonder' && arm !== 'spark') throw new Error('--arm wonder|spark required');
const data = resolve(import.meta.dirname, '../../../pactovio-demo-data');
const rfqDir = arg('rfq', join(data, 'hero-rfp'))!;
const csvPath = arg('csv', join(data, 'rax-catalogue/hubspot-products-final.csv'))!;
const outDir = resolve(arg('out', `/tmp/orchestrator-ab-${arm}`)!);
const RFQ_FILES = ['RFP-KCBL-ESURV-047.pdf', 'branch-floorplan.png', 'rfq-email.txt'];
mkdirSync(outDir, { recursive: true });

const toolCalls: { model: string; calls: string[] }[] = [];
let wonderRejected = 0;
const realFetch = globalThis.fetch;
const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let model = ''; let toolNames: string[] = [];
  if (typeof init?.body === 'string' && init.body.startsWith('{')) {
    try { const b = JSON.parse(init.body) as { model?: string; tools?: { function?: { name?: string } }[] }; model = b.model ?? ''; toolNames = (b.tools ?? []).map((t) => t.function?.name ?? ''); } catch { /* not JSON */ }
  }
  if (arm === 'spark' && model.includes('muse-wonder-1.0')) {
    wonderRejected++;
    return new Response(JSON.stringify({ error: { message: 'model does not exist' } }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const res = await realFetch(input, init);
  if (toolNames.includes('claim_check') && toolNames.includes('read_rfq')) { // the orchestrator's own turns
    try {
      const j = await res.clone().json() as { choices?: { message?: { tool_calls?: { function?: { name?: string } }[] } }[] };
      toolCalls.push({ model, calls: (j.choices?.[0]?.message?.tool_calls ?? []).map((t) => t.function?.name ?? '?') });
    } catch { toolCalls.push({ model, calls: ['<unparsed>'] }); }
  }
  return res;
}) as typeof fetch;

const { env, dispose } = localStorageEnv();
const migDir = join(import.meta.dirname, '../../apps/api/migrations');
const sql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n');
for (const st of sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) await env.DB.prepare(st).run();
Object.assign(env, { MODEL_DAILY_CAP_USD: '3', ENVIRONMENT: 'development' });
env.META_API_KEY = process.env.META_API_KEY;
const ws = (await customerFixture(env)).workspace;

const parse = (s: string): string[][] => { const rows: string[][] = []; let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]!; if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { cur.push(f); f = ''; } else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; } else if (c !== '\r') f += c; }
  return rows.filter((r) => r.length > 3); };
let products = 0;
for (const [name, sku, desc, price, , , , cat] of parse(readFileSync(csvPath, 'utf8')).slice(1)) {
  await env.DB.prepare("INSERT OR REPLACE INTO products (id, workspace_id, sku, name, family, specs_json, unit_price_minor, currency) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR')")
    .bind(`prd_${sku}`, ws, sku, name, cat ?? null, JSON.stringify({ description: desc, unit: 'nos' }), Math.round(Number(price) * 100)).run(); products++;
}
const id = await createProposal(env, ws, { source: 'api', input: { files: [] } });
const files: InputFile[] = [];
for (const f of RFQ_FILES) {
  const bytes = readFileSync(join(rfqDir, f)); const key = inputKey(ws, id, f);
  const mime = f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.png') ? 'image/png' : 'text/plain';
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } }); files.push({ key, filename: f, mime, size: bytes.length });
}
await env.DB.prepare('UPDATE proposals SET input_json = ? WHERE id = ?').bind(JSON.stringify({ files }), id).run();

const t0 = Date.now();
const tick = setInterval(async () => { const r = await listSteps(env, ws, id); process.stderr.write(`[${arm} ${Math.round((Date.now() - t0) / 1000)}s] ${r.map((x) => `${x.name}:${x.status}`).join(' ')}\n`); }, 20000);
let runError: string | null = null;
try { await runProposal(env, { proposalId: id, workspaceId: ws }, { fetchImpl: wrapped }); } catch (e) { runError = e instanceof Error ? e.message.slice(0, 200) : 'failed'; }
clearInterval(tick);
const wallMin = Number(((Date.now() - t0) / 60000).toFixed(2));
const { proposal: p, state } = await loadProposalJson(env, ws, id);
const steps = await listSteps(env, ws, id);
const row = await env.DB.prepare('SELECT status, orchestrator, error FROM proposals WHERE id = ?').bind(id).first<{ status: string; orchestrator: string | null; error: string | null }>();
const orch = steps.find((s) => s.name === 'orchestrate');
const reqs = state?.rfq?.requirements ?? [];
const pl = p?.floorplan?.placements ?? [];
const r4 = (n: number) => Number(n.toFixed(4));
const result = {
  arm, proposal_id: id, run_status: row?.status ?? 'unknown', run_error: runError ?? row?.error ?? null, catalogue_products: products, brain_loaded: false,
  orchestrator: row?.orchestrator ?? null, wonder_failed: /Spark fallback/.test(orch?.summary ?? ''), wonder_requests_rejected_by_harness: wonderRejected,
  total_cost_usd: r4(steps.reduce((a, s) => a + s.cost_usd, 0)), wall_minutes: wallMin,
  steps: steps.map((s) => ({ name: s.name, models: s.models, cost_usd: r4(s.cost_usd), ms: s.ms, status: s.status })),
  orchestrator_tool_call_order: toolCalls.flatMap((t) => t.calls),
  orchestrator_turns: toolCalls.map((t) => ({ model: t.model, calls: t.calls })),
  metrics: {
    requirements: reqs.length, requirements_with_page: reqs.filter((r) => r.page != null).length,
    share_with_page: reqs.length ? r4(reqs.filter((r) => r.page != null).length / reqs.length) : null,
    bom_lines: p?.scope_of_supply.length ?? null, grand_total_inr: p?.commercials.total_inr ?? null,
    compliance_rows: p?.compliance.length ?? null, compliance_by_status: p ? Object.fromEntries(['complies', 'partial', 'deviation'].map((k) => [k, p.compliance.filter((c) => c.status === k).length])) : null,
    floorplan_placements: pl.length, floorplan_sam_share: pl.length ? r4(pl.filter((x) => x.source === 'sam-3.1').length / pl.length) : null,
    evidence_items: p?.evidence.length ?? null, struck_claims: p?.struck_claims.length ?? null,
    go_no_go: p?.go_no_go ? { decision: p.go_no_go.decision, confidence: p.go_no_go.confidence } : null,
  },
};
writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 1));
writeFileSync(join(outDir, 'proposal.json'), JSON.stringify(p, null, 1)); // local only, not committed
process.stdout.write(`${JSON.stringify({ arm, status: result.run_status, orchestrator: result.orchestrator, cost: result.total_cost_usd, min: wallMin })}\n`);
await dispose();
