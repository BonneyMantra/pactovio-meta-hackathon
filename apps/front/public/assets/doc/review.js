// Review on the proposal page: edit the narrative in place (title, summaries, understanding, assumptions, exclusions),
// then approve. Each edit is saved as you leave the text; an edit after approval withdraws it until approved again.
import { api, h, icon, toast } from '../ui.js';

const LABEL = { in_review: 'Ready for review', approved: 'Approved · ready to send' };
// Footnote markers are rendered, not written: leave them out of what is saved.
const textOf = (el) => { const c = el.cloneNode(true); c.querySelectorAll('sup').forEach((s) => s.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };

/** Returns { el } for the page's action bar. `relayout()` re-paginates after editing; `onTitle(t)` updates the page heading. */
export function reviewControls({ p, id, doc, relayout, onTitle }) {
  let review = p.review || { status: 'in_review', edits: 0 };
  let editing = false, saving = Promise.resolve();
  const chip = h('span.chip.pd-review-chip');
  const editBtn = h('button.btn.btn-secondary.btn-sm', { type: 'button', onclick: () => toggle() });
  const approveBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => approve() });
  const editedNote = h('span.xs.muted.pd-review-note');

  function paint() {
    const ok = review.status === 'approved';
    chip.className = `chip pd-review-chip ${ok ? 'ok' : 'warn'}`;
    chip.replaceChildren(...[ok ? icon('check', 12) : null, LABEL[review.status] || LABEL.in_review].filter(Boolean));
    approveBtn.className = `btn btn-sm ${ok ? 'btn-secondary' : 'btn-primary'}`;
    approveBtn.replaceChildren(...[ok ? icon('check', 14) : null, ok ? 'Approved' : 'Approve'].filter(Boolean));
    approveBtn.disabled = ok || editing;
    editBtn.replaceChildren(...[editing ? icon('check', 14) : null, editing ? 'Done editing' : 'Edit text'].filter(Boolean));
    editedNote.textContent = review.edits ? `${review.edits} edit${review.edits > 1 ? 's' : ''} by the bid desk` : '';
  }

  async function save(el) {
    const text = textOf(el);
    if (!text || text === el.dataset.orig) { if (!text) el.textContent = el.dataset.orig; return; }
    const path = el.dataset.edit;
    saving = saving.then(async () => {
      try {
        ({ review } = await api(`/proposals/${encodeURIComponent(id)}`, { method: 'PATCH', body: { edits: [{ path, text }] } }));
        el.dataset.orig = text;
        if (path === 'title') onTitle?.(text);
        paint();
      } catch (e) { toast(e.message || 'That edit could not be saved.'); el.textContent = el.dataset.orig; }
    });
    await saving;
  }

  function toggle() {
    editing = !editing;
    doc.classList.toggle('pd-editing', editing);
    for (const el of doc.querySelectorAll('[data-edit]')) {
      if (editing) {
        el.dataset.orig = textOf(el);
        el.setAttribute('contenteditable', 'plaintext-only');
        el.onblur = () => save(el);
        el.onkeydown = (e) => { if (e.key === 'Escape') { el.textContent = el.dataset.orig; el.blur(); } };
      } else { el.removeAttribute('contenteditable'); el.onblur = null; el.onkeydown = null; }
    }
    if (editing) doc.querySelector('[data-edit]:not(.pd-title)')?.focus();
    else saving.then(() => relayout?.());
    paint();
  }

  async function approve() {
    approveBtn.disabled = true;
    await saving;
    try { ({ review } = await api(`/proposals/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action: 'approve' } })); toast('Approved · ready to send'); }
    catch (e) { toast(e.message || 'Approval could not be saved.'); }
    paint();
  }

  paint();
  return { el: h('div.pd-review', editedNote, chip, editBtn, approveBtn) };
}
