// Customer access: email → 6-digit code, in the same frame the onboarding continues in (assets/onb/stage.js).
import { h, icon } from './ui.js';
import { requestCode, verifyCode } from './customer-api.js';
import { stage } from './onb/stage.js';
import { otpField } from './onb/otp.js';

export function gateFrame() {
  document.body.classList.add('pv-gated');
  let gate = document.getElementById('access');
  if (!gate) { gate = h('main.access', { id: 'access' }); document.body.append(gate); }
  return gate;
}
export function leaveGate() { document.getElementById('access')?.remove(); document.body.classList.remove('pv-gated'); }

/** A short notice ("Opening your private workspace…") in the left column; the panel and mode stay as they are. */
export function gateLayout(root, content) {
  stage(root).ask(h('div.pv-form.pv-notice-wrap', content));
}

export function gateError(root, error, retry) {
  const s = stage(root);
  s.ask(h('div.pv-form', h('div.pv-heading', h('h1', { tabindex: '-1' }, 'Let’s try that again'), h('p.pv-lede', errorText(error))),
    h('button.pv-btn', { type: 'button', onclick: retry }, 'Try again', icon('refresh', 16))));
  s.el.querySelector('.pv-btn')?.focus();
}

// Only the address and non-secret timestamps survive a reload; the code itself is never stored.
const KEY = 'pactovio.auth.challenge.v1';
function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v.email === 'string' && Number.isFinite(v.retryAt) && Number.isFinite(v.expiresAt) && v.expiresAt > Date.now() ? v : null;
  } catch { return null; }
}
function writeSaved(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* optional */ } }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function errorText(e) {
  if (e?.status === 401) return 'Your session expired. Sign in again to continue.';
  if (e?.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (e?.code === 'invalid_code') return 'That code is incorrect or expired. Use the latest email or request a new code.';
  if ([400, 409, 422].includes(e?.status) && e.message && !/^Request failed/.test(e.message) && e.message.length < 200) return e.message;
  return 'We could not complete that request. Your details are still here. Please try again.';
}
const sendError = (e) => (['auth_unavailable', 'delivery_unavailable'].includes(e?.code) ? 'We could not send a code right now. Try again in a little while.' : errorText(e));

export function renderAuth(root, onVerified, notice = '') {
  const s = stage(root).mode('auth').work(null).who(null);
  const saved = readSaved();
  let email = saved?.email || '', step = saved ? 'code' : 'email', challenge = saved;
  let busy = '', error = '', info = notice, verifyAt = 0, seq = 0, disposed = false;
  let ui = {};

  const now = () => Date.now();
  const matches = () => !!challenge && challenge.email === email.trim().toLowerCase();
  const remaining = () => (matches() ? Math.max(0, Math.ceil((challenge.retryAt - now()) / 1000)) : 0);
  const expired = () => step === 'code' && (!matches() || challenge.expiresAt <= now());
  const verifyWait = () => Math.max(0, Math.ceil((verifyAt - now()) / 1000));

  function paint() {
    if (disposed || !ui.button) return;
    const code = step === 'code', wait = code ? verifyWait() : remaining();
    const label = busy === 'request' ? 'Sending code…' : busy === 'verify' ? 'Verifying…' : wait ? `Try again in ${wait}s` : code ? 'Verify code' : 'Continue';
    ui.button.replaceChildren(...(busy ? [h('span.pv-spin', { 'aria-hidden': 'true' }), label] : [label, icon('arrow', 16)]));
    ui.button.disabled = !!busy || (code ? expired() || verifyWait() > 0 : remaining() > 0);
    ui.form.setAttribute('aria-busy', String(!!busy));
    const text = error || (code ? (expired() ? 'This code has expired. Request a new one.' : 'Enter the 6-digit code from your inbox.') : info);
    if (ui.status.textContent !== text) ui.status.textContent = text;
    ui.status.className = error ? 'pv-status pv-error' : 'pv-status';
    ui.status.setAttribute('role', error ? 'alert' : 'status');
    if (code) {
      ui.otp.invalid(!!error); ui.otp.disabled(!!busy || expired());
      ui.resend.disabled = !!busy || remaining() > 0;
      ui.resend.textContent = remaining() ? `Resend code in ${remaining()}s` : 'Resend code';
    } else {
      ui.email.disabled = !!busy;
      ui.email.setAttribute('aria-invalid', String(!!error));
    }
  }

  async function send() {
    if (busy || remaining()) return;
    const value = (ui.email ? ui.email.value : email).trim().toLowerCase();
    if (!EMAIL.test(value) || value.length > 254) { error = 'Enter a valid email address.'; paint(); ui.email?.focus(); return; }
    const id = ++seq;
    busy = 'request'; error = ''; info = ''; paint();
    try {
      const r = await requestCode(value);
      if (disposed || id !== seq) return;
      email = value;
      challenge = { email: value, retryAt: now() + (r.retry_after || 60) * 1000, expiresAt: now() + (r.expires_in || 600) * 1000 };
      writeSaved(challenge);
      busy = ''; step = 'code'; draw();
    } catch (e) {
      if (disposed || id !== seq) return;
      error = sendError(e);
      if (e.status === 429) challenge = { email: value, retryAt: now() + (e.retryAfter || 60) * 1000, expiresAt: challenge?.expiresAt ?? 0 };
      busy = ''; paint(); (ui.email || ui.otp)?.focus();
    }
  }

  async function verify() {
    if (busy || expired() || verifyWait()) return;
    const code = ui.otp.value;
    if (!/^\d{6}$/.test(code)) { error = 'Enter all six digits from your email.'; paint(); ui.otp.focus(); return; }
    const id = ++seq;
    busy = 'verify'; error = ''; paint();
    try {
      await verifyCode(email, code);
      if (disposed || id !== seq) return;
      writeSaved(null);
      await onVerified();
    } catch (e) {
      if (disposed || id !== seq) return;
      error = errorText(e);
      if (e.status === 429) verifyAt = now() + (e.retryAfter || 60) * 1000;
      busy = ''; ui.otp.clear(); paint(); ui.otp.focus();
    }
  }

  function changeMail() {
    seq += 1; busy = ''; challenge = null; writeSaved(null); error = ''; info = ''; verifyAt = 0; step = 'email';
    draw();
  }

  function draw() {
    const code = step === 'code';
    const status = h('p.pv-status', { id: 'auth-status', role: 'status' });
    const button = h('button.pv-btn', { type: 'submit' });
    const heading = h('div.pv-heading', h('h1', { tabindex: '-1' }, code ? 'Check your email' : 'Sign in or sign up'),
      code ? h('p.pv-subtitle', h('span', email), h('button.pv-link', { type: 'button', onclick: changeMail }, 'Change Mail?')) : null);
    ui = { status, button };
    let field;
    if (code) {
      ui.otp = otpField({ id: 'auth-code', describedBy: 'auth-status', onChange: () => { if (error) { error = ''; paint(); } }, onComplete: () => verify() });
      ui.resend = h('button.pv-link.pv-resend', { type: 'button', onclick: () => send() });
      field = h('div.pv-field', h('label.sr-only', { for: 'auth-code' }, '6-digit code'), ui.otp.el);
    } else {
      ui.email = h('input.pv-input', { id: 'auth-email', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', maxlength: 254, placeholder: 'you@company.com', value: email, 'aria-describedby': 'auth-status',
        oninput: (e) => { email = e.target.value; if (error) { error = ''; paint(); } else paint(); } });
      field = h('div.pv-field', h('label.pv-label', { for: 'auth-email' }, 'Email address'), ui.email);
    }
    ui.form = h('form.pv-form.pv-auth-form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); if (code) verify(); else send(); } },
      heading, field, status, button, code ? ui.resend : null);
    s.ask(ui.form);
    paint();
    (code ? ui.otp : ui.email).focus({ preventScroll: true });
  }

  const timer = setInterval(paint, 1000);
  draw();
  return () => { disposed = true; seq += 1; clearInterval(timer); };
}
