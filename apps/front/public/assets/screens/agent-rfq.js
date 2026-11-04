// Chat additions: drop an RFQ (and drawings) to start a proposal run, live run card with the model behind each step,
// and a microphone that sends 16 kHz WAV to /api/voice/transcribe.
import { h, icon, toast } from '../ui.js';
import { startProposal, getProposal, transcribe } from '../brain-api.js';
import { canRecord, startRecording } from '../voice.js';
import { steps } from '../doc/rail.js';
import { inrShort, assetUrl } from '../doc/kit.js';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt';
const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function rfqKit({ win, ta, feed, scroll, threadId, setBusy }) {
  let files = [], rec = null, timer = null;
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
    ta.focus();
  }
  function draw() {
    tray.hidden = !files.length;
    tray.replaceChildren(...files.map((f, i) => h('span.rq-file', icon(/\.(png|jpe?g|webp)$/i.test(f.name) ? 'file' : 'tender', 14),
      h('span.rq-fname', f.name), h('span.rq-tag', i === 0 ? 'RFQ' : 'Drawing'), h('span.xs.muted', kb(f.size)),
      h('button', { type: 'button', 'aria-label': `Remove ${f.name}`, onclick: () => { files.splice(i, 1); draw(); } }, icon('x', 12)))));
    ta.placeholder = files.length ? 'Add a note for this proposal (optional)…' : 'Ask about a tender, an RFQ or a quote…';
  }

  async function toggleMic() {
    if (rec) {
      clearInterval(timer); mic.classList.remove('rec'); mic.classList.add('busy'); mic.disabled = true;
      try {
        const wav = await rec.stop(); rec = null;
        const { text } = await transcribe(wav);
        if (text) { ta.value = `${ta.value ? `${ta.value.trim()} ` : ''}${text}`; ta.dispatchEvent(new Event('input')); ta.focus(); }
        else toast('No speech was recognised. Try again a little closer to the microphone.');
      } catch (e) { toast(e.message || 'Voice transcription failed.'); }
      finally { rec = null; mic.classList.remove('busy'); mic.disabled = false; mic.replaceChildren(icon('mic', 17)); }
      return;
    }
    try { rec = await startRecording(); } catch { toast('Microphone access was blocked. Allow it in the browser to speak to the agent.'); return; }
    const t0 = Date.now();
    mic.classList.add('rec');
    const tick = () => { const s = Math.floor((Date.now() - t0) / 1000); mic.replaceChildren(h('i'), h('span', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)); if (s >= 120) toggleMic(); };
    tick(); timer = setInterval(tick, 500);
  }

  async function run(text) {
    const [rfq, ...extras] = files;
    files = []; draw();
    feed.querySelector('.welcome')?.remove();
    feed.append(h('div.msg.user', h('div.bubble', text ? h('p', text) : null, h('div.rq-sent', [rfq, ...extras].map((f) => h('span', icon('file', 13), f.name))))));
    const list = h('div', steps([{ label: 'Uploading the request', status: 'running' }])), bar = h('i'), result = h('div');
    const card = h('div.rq-run', h('div.rq-head', h('span.rq-ico', icon('file', 16)), h('div', h('strong', 'Writing the proposal'), h('div.xs.muted', rfq.name))), list, h('div.rq-bar', bar), result);
    feed.append(h('div.msg.assistant', h('span.agent-av', icon('logo', 14)), h('div.msg-col', h('div.msg-who', 'Pactovio', h('span.xs.muted', 'now')), card)));
    scroll(); setBusy(true);
    let id;
    try { id = (await startProposal({ file: rfq, extras, text, threadId: threadId() })).id; }
    catch (e) { list.replaceChildren(h('div.error-box', e.message)); setBusy(false); return; }
    setBusy(false);
    const poll = async () => {
      let p;
      try { p = await getProposal(id); } catch { setTimeout(poll, 2500); return; }
      const ps = p.proposal ? { ...p.proposal, status: p.status, steps: p.steps ?? p.proposal.steps } : p;
      const st = ps.steps || [];
      if (st.length) list.replaceChildren(steps(st));
      const done = st.filter((s) => s.status === 'done').length;
      bar.style.width = `${ps.status === 'ready' ? 100 : st.length ? (done / st.length) * 92 + 4 : 8}%`;
      scroll();
      if (ps.status === 'failed') { result.replaceChildren(h('div.error-box', ps.error || 'The run failed. Try again, or send the RFQ as a PDF.')); return; }
      if (ps.status !== 'ready') { setTimeout(poll, 1500); return; }
      card.classList.add('done');
      card.querySelector('.rq-head strong').textContent = 'Proposal ready';
      result.replaceChildren(h('a.rq-doc', { href: `#/proposals/${encodeURIComponent(id)}` },
        h('div.rq-sheet', h('div.rq-sheet-k', ps.ref || 'Proposal'), h('div.rq-sheet-t', ps.title), ps.concept_visual?.image_ref ? h('img', { src: assetUrl(id, ps.concept_visual.image_ref), alt: '' }) : h('div.rq-sheet-l'), h('div.rq-sheet-l.s'), h('div.rq-sheet-l')),
        h('div.rq-doc-meta', h('div.small', ps.client?.name), h('div.rq-doc-v.num', inrShort(ps.commercials?.total_inr)), h('div.xs.muted', [ps.go_no_go?.decision === 'go' ? `Go · ${Math.round((ps.go_no_go.confidence || 0) * 100)}% confidence` : null, `${(ps.scope_of_supply || []).length} line items`].filter(Boolean).join(' · ')),
          h('span.btn.btn-primary.btn-sm', 'Open proposal', icon('arrow', 14)))));
      scroll();
    };
    poll();
  }

  return { tray, attach, mic, hasFiles: () => files.length > 0, run };
}
