import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SAM_SSE = readFileSync(resolve(__dirname, '../../../fixtures/proposal/sam-rectangle-hero.sse'), 'utf8');
export const TINY_JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const TOOLS = ['read_rfq', 'select_solution', 'compose_bom', 'design_architecture', 'place_on_floor_plan', 'compliance_matrix', 'concept_visual', 'claim_check'];

export const RFQ_JSON = {
  rfq_ref: 'KCBL/ITD/PROC/2026-27/ESURV/047', title: 'E-surveillance and intrusion alarm for 120 ATMs and 18 branches', due_date: '2026-11-24',
  summary: 'Kurinji Commercial Bank Limited seeks e-surveillance for 120 ATM sites and 18 branches with a central SOC dashboard.',
  floorplan_file: 'plan.png',
  client: { name: 'Kurinji Commercial Bank Limited', sector: 'Banking', city: 'Chennai', country: 'India', contact_name: 'Procurement', contact_title: 'IT Department' },
  sites: { atm: 120, branch: 18 },
  requirements: [
    { id: 'R1', text: 'ATM site panel with 8 alarm zones and 4G dual SIM communication', category: 'functional', mandatory: true, page: 6, doc: 'rfp.txt' },
    { id: 'R2', text: 'Edge analytics for loitering and crowding detection at ATM lobby', category: 'functional', mandatory: true, page: 7, doc: 'rfp.txt' },
    { id: 'R3', text: 'Door contacts and glass-break detectors at every ATM site', category: 'functional', mandatory: true, page: 7, doc: 'rfp.txt' },
    { id: 'R4', text: 'SecureLink v2 integration over MQTT 5 with the bank SOC', category: 'integration', mandatory: true, page: 9, doc: 'rfp.txt' },
    { id: 'R5', text: 'Bidder must have staffed service centres in Tamil Nadu and Karnataka', category: 'eligibility', mandatory: true, page: 12, doc: 'rfp.txt' },
    { id: 'R6', text: 'Pilot at 6 sites within 4 weeks; rollout within 16 weeks', category: 'timeline', mandatory: true, page: 14, doc: 'rfp.txt' },
  ],
};
const SELECTION = {
  lines: [
    { sku: 'RT-AP-8Z', scope: 'per_atm_site', qty: 1, requirement_ids: ['R1'], rationale: '8-zone panel' },
    { sku: 'RT-EVA-G0', scope: 'per_atm_site', qty: 1, requirement_ids: ['R2'], rationale: 'edge analytics' },
    { sku: 'EXT-PIR-SENS', scope: 'per_atm_site', qty: 2, requirement_ids: ['R1'], rationale: 'PIR' },
    { sku: 'RT-DOES-NOT-EXIST', scope: 'central', qty: 1, requirement_ids: ['R4'], rationale: 'invented' },
    { sku: 'SVC-SURVEY', scope: 'project', qty: 1, requirement_ids: ['R6'], rationale: 'survey' },
  ],
  gaps: [
    { requirement_ids: ['R3'], kind: 'external', item: 'Door contacts and glass-break detectors', note: 'Not in catalogue; source with OEM authorisation' },
    { requirement_ids: ['R4'], kind: 'custom', item: 'SecureLink v2 MQTT gateway', note: 'New firmware and SOC integration' },
  ],
  similar_used: ['PR/2025/001', 'PR/BOGUS'],
};
const NARRATIVE = {
  title: 'E-surveillance and Intrusion Alarm System for 120 ATMs and 18 Branches',
  external_items: [
    { sku: 'EXT-PIR-SENS', description: 'PIR motion sensor', unit: 'nos', qty_basis: 'per_atm_site', qty: 2, unit_price_inr: 99999 },
    { sku: 'EXT-DOORCONTACT', description: 'Magnetic door contact, wired', unit: 'nos', qty_basis: 'per_atm_site', qty: 2, unit_price_inr: 400 },
  ],
  work_packages: [{ work_package: 'WP-1', description: 'SecureLink v2 MQTT gateway firmware', person_days: 20, kind: 'firmware' }],
  plan: [{ name: 'Survey and design freeze', weeks: 3, deliverables: 'Site survey report' }, { name: 'Pilot at 6 sites', weeks: 4, deliverables: 'Pilot acceptance' }, { name: 'Rollout', weeks: 16, deliverables: 'All sites live' }],
  executive_summary: 'Thank you for your RFP KCBL/ITD/PROC/2026-27/ESURV/047. We propose the RT-AP-8Z alarm panel with edge analytics at 120 ATM sites. The project value is {{TOTAL_INR}} excluding nothing else.\n\nWe are ISO 27001 certified with 400 engineers worldwide. Delivery takes 23 weeks.',
  requirement_understanding: ['ATM site panel with 8 alarm zones and 4G dual SIM communication.'], solution_overview: 'Each ATM site carries an 8-zone panel with edge analytics reporting to the bank SOC over MQTT.',
  assumptions: ['Client provides mains power.', 'Client provides network access.', 'Client provides civil works and access.'], exclusions: ['Civil works.', 'Client-side network changes.', 'Software licences beyond those listed.'],
  discount_pct: 0,
};
const DESIGN = {
  nodes: [{ id: 'n1', label: 'ATM site panel', kind: 'rax_product' }, { id: 'n2', label: 'Bank SOC', kind: 'client_system' }],
  links: [{ from: 'n1', to: 'n2', label: 'MQTT 5' }, { from: 'n1', to: 'n9', label: 'dangling' }],
  zone_map: [{ zone: 'Z1', device_sku: 'EXT-PIR-SENS', input: 'IN1', wiring: 'NC loop, 2-core' }, { zone: 'Z2', device_sku: 'NOT-SUPPLIED', input: 'IN2', wiring: 'n/a' }],
};
const PLACEMENTS = { placements: [
  { device_sku: 'EXT-PIR-SENS', label: 'PIR - ATM lobby', anchor_id: 'A1', where: 'above', approx_xy: null },
  { device_sku: 'RT-AP-8Z', label: 'Panel - server room', anchor_id: null, where: 'on', approx_xy: [0.2, 0.55] },
  { device_sku: 'NOT-IN-KIT', label: 'ghost', anchor_id: 'A2', where: 'on', approx_xy: null },
] };
const COMPLIANCE = { rows: [
  { requirement_id: 'R1', status: 'complies', remark: 'RT-AP-8Z provides 8 zones.' }, { requirement_id: 'R2', status: 'complies', remark: 'RT-EVA-G0 edge analytics.' },
  { requirement_id: 'R3', status: 'partial', remark: 'Bought-out items subject to OEM authorisation.' }, { requirement_id: 'R4', status: 'partial', remark: 'Needs WP-1 gateway firmware.' },
  { requirement_id: 'R5', status: 'deviation', remark: 'Karnataka service centre not on record; partner needed.' },
] };

export interface MockOpts { wonderDown?: boolean; samDown?: boolean }
export function mockModels(o: MockOpts = {}) {
  const calls: { url: string; model?: string; sys?: string }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    const sys = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content as string : '';
    calls.push({ url, model: body.model, sys: sys.slice(0, 40) });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const chat = (content: string | null, tool?: string) => json({ id: 'c', object: 'chat.completion', model: body.model, usage: { prompt_tokens: 1200, completion_tokens: 400 }, choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool ? { tool_calls: [{ id: `call_${tool}`, type: 'function', function: { name: tool, arguments: '{}' } }] } : {}) } }] });
    if (url.endsWith('/responses')) return o.samDown ? json({ error: { message: 'sam unavailable' } }, 500) : new Response(SAM_SSE, { headers: { 'content-type': 'text/event-stream' } });
    if (url.endsWith('/images/generations')) return json({ data: [{ b64_json: TINY_JPEG }] });
    if (!url.endsWith('/chat/completions')) return json({ error: { message: 'unexpected' } }, 404);
    if (sys.includes('bid-desk orchestrator')) {
      if (o.wonderDown && body.model === 'muse-wonder-1.0') return json({ error: { message: 'model not served', code: 'model_not_found' } }, 404);
      const done = (body.messages as { role: string }[]).filter((m) => m.role === 'tool').length;
      return done >= TOOLS.length ? chat('DONE') : chat(null, TOOLS[done]);
    }
    const pick = (k: string, v: unknown) => (sys.includes(k) ? chat(JSON.stringify(v)) : null);
    return pick('extract what a bid team needs', RFQ_JSON) ?? pick('Map the buyer', SELECTION) ?? pick('commercial and narrative', NARRATIVE) ?? pick('system architecture', DESIGN)
      ?? pick('place security devices', PLACEMENTS) ?? pick('compliance reviewer', COMPLIANCE) ?? json({ error: { message: `unmocked: ${sys.slice(0, 60)}` } }, 500);
  }) as typeof fetch;
  return { fetch: fn, calls };
}
