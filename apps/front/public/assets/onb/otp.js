// Six-slot one-time-code field. One real <input> (digits, paste, one-time-code autofill, mobile keypad) sits over six
// drawn slots, so screen readers, password managers and SMS/email autofill see a single ordinary field.
import { h } from '../ui.js';

export function otpField({ id, describedBy, onChange, onComplete }) {
  const slots = Array.from({ length: 6 }, () => h('div.pv-otp-slot', { 'data-slot': 'otp' }));
  const group = h('div.pv-otp-group', slots);
  const input = h('input.pv-otp-input', {
    id, type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]*',
    spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-describedby': describedBy, 'data-1p-ignore': 'true', 'data-lpignore': 'true',
  });
  const el = h('div.pv-otp', group, input);
  let last = '';

  const end = () => { try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* not focusable yet */ } };
  function paint() {
    const v = input.value, focused = document.activeElement === input;
    const at = Math.min(v.length, 5);
    slots.forEach((s, i) => {
      const active = focused && i === at && !(v.length === 6 && i !== 5);
      s.dataset.active = String(active);
      s.replaceChildren(v[i] ? document.createTextNode(v[i]) : active ? h('span.pv-caret') : '');
    });
  }
  function take(raw) {
    const v = String(raw || '').replace(/\D/g, '').slice(0, 6);
    if (input.value !== v) input.value = v;
    end(); paint();
    if (v === last) return;
    last = v; onChange?.(v);
    if (v.length === 6) onComplete?.(v);
  }
  input.addEventListener('input', () => take(input.value));
  input.addEventListener('paste', (e) => { e.preventDefault(); take(e.clipboardData?.getData('text')); });
  ['focus', 'blur', 'click', 'keyup', 'select'].forEach((t) => input.addEventListener(t, () => { if (t !== 'blur') end(); paint(); }));
  paint();

  return {
    el, input,
    get value() { return input.value; },
    clear() { input.value = ''; last = ''; paint(); },
    focus() { input.focus({ preventScroll: true }); end(); paint(); },
    invalid(on) { group.dataset.invalid = String(!!on); input.setAttribute('aria-invalid', String(!!on)); },
    disabled(on) { input.disabled = !!on; el.setAttribute('aria-disabled', String(!!on)); paint(); },
  };
}
