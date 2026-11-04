// Chat additions: drop an RFQ (and drawings) to start a proposal run, live run card with the model behind each step,
// and a microphone that sends 16 kHz WAV to /api/voice/transcribe.
import { api, h, icon, toast } from '../ui.js';
import { agentLabel } from '../agent-id.js';
import { startProposal, getProposal, transcribe, speechHints, STAGES } from '../doc/api.js';
import { eligibilityFlags, flagsSig } from '../doc/flags.js';
import { canRecord, startRecording } from '../voice.js';
import { steps, liveSteps } from '../doc/steps.js';
import { inrShort, assetUrl } from '../doc/kit.js';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt';
const GO = { go: 'Go', conditional: 'Bid with conditions', no_go: 'No bid' };
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

const shortClient = (n) => String(n || '').replace(/[,\s]*\b(limited|ltd|private|pvt|llc|llp|inc|plc|saoc|wll|co)\b\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
/** "Integrated E-Surveillance, Intrusion Alarm … for 120 ATMs" -> "e-surveillance" (acronyms such as SCADA or RTUs keep their case). */
function subject(t) {
  const s = String(t || '').replace(/^(integrated|supply(,| of)?|provision of|procurement of|design,?|request for (proposal|quotation) (for|on))\s+/i, '').split(/,|\s+for\s+|\s+and\s+|\s+at\s+/i)[0].trim();
  const words = s.split(/\s+/).map((w) => (w.split('-').every((x) => /^[A-Z][a-z]*$/.test(x)) ? w.toLowerCase() : w)).join(' ');
  return words.length > 36 ? `${words.slice(0, 35).trim()}…` : words;
}
/** Conversation title from what the RFQ says: "Kurinji Commercial Bank · e-surveillance RFP". */
export function rfqTitle(rfq, filename = '') {
  const kind = /\brfp\b|proposal/i.test(`${rfq?.rfq_ref || ''} ${filename} ${rfq?.title || ''}`) ? 'RFP' : /tender/i.test(`${rfq?.title || ''} ${filename}`) ? 'tender' : 'RFQ';
  const parts = [shortClient(rfq?.client?.name), [subject(rfq?.title), kind].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(' · ').slice(0, 80);
}
const fileTitle = (name) => String(name || 'RFQ').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 80);

export function rfqKit({ win, ta, feed, scroll, threadId, setBusy, thread, onMode }) {
  let files = [], rec = null, hearing = false, timer = null, hints = [], base = '', heard = '';
  // What the next send does: 'voice' while the mic records or transcribes, 'proposal' with an RFQ attached, else 'chat'.
  const mode = () => (hearing ? 'voice' : files.length ? 'proposal' : 'chat');
  const tell = () => onMode?.(mode());
  // The company's short name for the agent's first reply ("the way Rax writes them").
  let company = null;
  api('/brain').then((b) => { const n = b?.profile?.legal_name || b?.profile?.name || ''; company = n.split(/\s+/)[0] || null; }).catch(() => {});
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: () => { add([...input.files]); input.value = ''; } });
  const tray = h('div.rq-tray', { hidden: true });
  const attach = h('button.rq-btn', { type: 'button', title: 'Attach an RFQ or drawing', 'aria-label': 'Attach an RFQ or drawing', onclick: () => input.click() }, icon('clip', 17));
  const mic = h('button.rq-btn', { type: 'button', title: 'Speak', 'aria-label': 'Record a voice message', hidden: !canRecord(), onclick: toggleMic }, icon('mic', 17));
  const overlay = h('div.rq-drop', h('div', icon('upload', 26), h('strong', 'Drop the RFQ and any drawings'), h('span', 'Pactovio writes the proposal from your catalogue, in your house style')));
  win.append(overlay, input);

  let depth = 0;
  win.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth++; win.classList.add('rq-over'); });
  win.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  win.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) win.classList.remove('rq-over'); });
  win.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; win.classList.remove('rq-over'); add([...(e.dataTransfer?.files || [])]); });

  function add(list) {
    const ok = list.filter((f) => f.size <= 25e6);
    if (ok.length < list.length) toast('Files over 25 MB were left out.');
    files = [...files, ...ok].slice(0, 6);
    draw();
    // Names on the RFQ's first page help the recogniser spell them (the buyer, places, people); fetched once per RFQ.
    const doc = files.find((f) => /\.(pdf|txt|eml|md)$/i.test(f.name));
    if (doc && doc !== hints.file) { hints = Object.assign([], { file: doc }); speechHints(doc).then((k) => { if (hints.file === doc) hints = Object.assign(k, { file: doc }); }); }
    ta.focus();
  }
  function draw() {
    tray.hidden = !files.length;
    tray.replaceChildren(...files.map((f, i) => h('span.rq-file', icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? 'file' : 'tender', 14),
      h('span.rq-fname', f.name), h('span.rq-tag', i === 0 ? 'RFQ' : 'Drawing'), h('span.xs.muted', kb(f.size)),
      h('button', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); draw(); } }, icon('x', 12)))));
    ta.placeholder = files.length ? 'Add a note for this proposal (optional)…' : 'Ask about a tender, an RFQ or a quote…';
    tell();
  }

  const show = (t) => { ta.value = `${base}${t}`; ta.dispatchEvent(new Event('input')); };
  // While recording, everything heard so far is re-transcribed about every two seconds, so the words appear as they are spoken.
  async function listen(r) {
    while (rec === r) {
      const t0 = Date.now();
      try {
        const wav = await r.snapshot();
        if (wav && rec === r) { const { text } = await transcribe(wav, hints); if (rec === r && text) { heard = text; show(text); } }
      } catch { /* a missed partial is fine: the final pass runs on stop */ }
      await new Promise((ok) => setTimeout(ok, Math.max(400, 2000 - (Date.now() - t0))));
    }
  }

  async function toggleMic() {
    if (rec) {
      clearInterval(timer); mic.classList.remove('rec'); mic.classList.add('busy'); mic.disabled = true; ta.classList.remove('rq-hearing');
      const r = rec; rec = null;
      try {
        const wav = await r.stop();
        const { text } = await transcribe(wav, hints);
        if (text || heard) { show(text || heard); ta.focus(); }
        else toast('No speech was recognised. Try again a little closer to the microphone.');
      } catch (e) { if (heard) show(heard); else toast(e.message || 'Voice transcription failed.'); }
      finally { mic.classList.remove('busy'); mic.disabled = false; mic.replaceChildren(icon('mic', 17)); hearing = false; tell(); }
      return;
    }
    try { rec = await startRecording(); } catch { toast('Microphone access was blocked. Allow it in the browser to speak to the agent.'); return; }
    base = ta.value.trim() ? `${ta.value.trim()} ` : ''; heard = '';
    const t0 = Date.now();
    mic.classList.add('rec'); ta.classList.add('rq-hearing'); hearing = true; tell();
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); mic.replaceChildren(h('i'), h('span', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)); if (s >= 120) toggleMic(); };
    tick(); timer = setInterval(tick, 500);
    listen(rec);
  }

  async function run(text) {
    const [rfq, ...extras] = files;
    files = []; draw();
    feed.querySelector('.welcome')?.remove();
    feed.append(h('div.msg.user', h('div.bubble', text ? h('p', text) : null, h('div.rq-sent', [rfq, ...extras].map((f) => h('span', icon('file', 13), f.name))))));
    const list = h('div', steps([{ label: `Uploading ${[rfq, ...extras].length > 1 ? `${[rfq, ...extras].length} files` : 'the request'}`, status: 'running' }])), bar = h('i'), result = h('div');
    const orch = h('span.xs.muted'), flags = h('div');
    const reply = h('p.rq-reply', `Got it. Reading it now. I'll check eligibility first, then build it the way ${company || 'you'} write${company ? 's' : ''} them.`);
    const card = h('div.rq-run', h('div.rq-head', h('span.rq-ico', icon('file', 16)), h('div', h('strong', 'Writing the proposal'), h('div.xs.muted', rfq.name, ' ', orch))), list, h('div.rq-bar', bar), flags, result);
    feed.append(h('div.msg.assistant', h('span.agent-av', icon('logo', 14)), h('div.msg-col', h('div.msg-who', agentLabel(), h('span.xs.muted', 'now')), reply, card)));
    scroll(); setBusy(true);
    let id;
    try { id = (await startProposal({ file: rfq, extras, text })).id; }
    catch (e) { list.replaceChildren(h('div.error-box', e.message)); setBusy(false); return; }
    setBusy(false);
    let fails = 0, fsig = '', named = false;
    const conv = thread ? await thread.ensure(fileTitle(rfq.name)).catch(() => null) : null;
    const live = liveSteps();
    const poll = async () => {
      let p;
      try { p = await getProposal(id); fails = 0; } catch (e) {
        // A redeploy can briefly answer 404; only a run that stays missing (or keeps failing) is abandoned.
        if (++fails > 12 || (e?.status === 404 && fails > 5)) { result.replaceChildren(h('div.error-box', 'Lost track of this run. Open it from Proposals.')); return; }
        setTimeout(poll, 2500); return;
      }
      const ps = p, st = ps.steps || [];
      // Rows update in place, so each finished step ticks visibly instead of the list re-rendering.
      if (st.length) { live.update(st); if (!live.el.isConnected) { list.replaceChildren(live.el); scroll(); } }
      // Name a conversation this run started once the RFQ says who is buying what.
      const rfqRead = ps.partial?.rfq || (ps.client ? { client: ps.client, title: ps.title, rfq_ref: ps.rfq_ref } : null);
      if (conv?.fresh && !named && rfqRead?.client?.name) { named = true; thread.rename(conv.id, rfqTitle(rfqRead, rfq.name)).catch(() => {}); }
      const elig = ps.partial?.eligibility;
      if (elig && flagsSig(elig) !== fsig) { fsig = flagsSig(elig); flags.replaceChildren(eligibilityFlags(elig) || ''); scroll(); }
      if (ps.orchestrator) orch.textContent = `· orchestrated by ${ps.orchestrator}`;
      const done = st.filter((s) => s.status === 'done').length;
      bar.style.width = `${ps.status === 'ready' ? 100 : (done / STAGES.length) * 92 + 4}%`;
      if (ps.status === 'failed') { result.replaceChildren(h('div.error-box', ps.error || 'The run failed. Try again, or send the RFQ as a PDF.')); return; }
      if (ps.status !== 'ready') { setTimeout(poll, 2500); return; }
      card.classList.add('done');
      card.querySelector('.rq-head strong').textContent = 'Proposal ready';
      result.replaceChildren(h('a.rq-doc', { href: `#/proposals/${encodeURIComponent(id)}` },
        h('div.rq-sheet', h('div.rq-sheet-k', ps.ref || 'Proposal'), h('div.rq-sheet-t', ps.title), ps.concept_visual?.image_ref ? h('img', { src: assetUrl(id, ps.concept_visual.image_ref), alt: '' }) : h('div.rq-sheet-l'), h('div.rq-sheet-l.s'), h('div.rq-sheet-l')),
        h('div.rq-doc-meta', h('div.small', ps.client?.name), h('div.rq-doc-v.num', inrShort(ps.commercials?.total_inr)), h('div.xs.muted', [ps.go_no_go ? `${GO[ps.go_no_go.decision] || ps.go_no_go.decision} · ${Math.round((ps.go_no_go.confidence || 0) * 100)}%` : null, `${(ps.scope_of_supply || []).length} line items`, ps.floorplan ? `${(ps.floorplan.placements || []).length} devices placed` : null].filter(Boolean).join(' · ')),
          h('span.btn.btn-primary.btn-sm', 'Open proposal', icon('arrow', 14)))));
      scroll();
    };
    poll();
  }

  return { tray, attach, mic, mode, hasFiles: () => files.length > 0, run };
}
