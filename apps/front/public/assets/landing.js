// Landing interactions: icons, sticky nav hairline, hero reveal, composer typing, capability list, logo wall, rosters.
import { icon } from './ui.js';
import { AGENTS, CAPS, CONNECTORS, MARKS, MODELS } from './landing-data.js';
import { brandTile, brandTileHTML } from './brand-logos.js';

const $ = (sel, root = document) => root.querySelector(sel);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function fillIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    el.appendChild(icon(el.dataset.ico, el.classList.contains('tile-o') ? 34 : el.classList.contains('ict') ? 22 : 15));
  });
}

const iconTile = (name, size) => `<span class="logo-tile neutral ico-tile" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.28)}px">${icon(name, Math.round(size * 0.66)).outerHTML}</span>`;
const mark = (k) => (MARKS[k].brand ? brandTileHTML(MARKS[k].brand, 16) : iconTile(MARKS[k].ico, 16));
const cites = (html) => html.replace(/\[(\d+)\]/g, '<span class="cite">$1</span>');
const logo = (x, size = 40) => (x.brand ? brandTileHTML(x.brand, size) : iconTile(x.ico || 'dot', size));
function nav() {
  const n = $('#nav');
  const on = () => n.classList.toggle('scrolled', scrollY > 8);
  on();
  addEventListener('scroll', on, { passive: true });
}

function heroReveal() {
  const step = $('.tw[data-step="1"]');
  if (!step) return;
  setTimeout(() => step.classList.add('on'), reduce ? 0 : 1100);
  typeLoop($('#hero-ph'), ['Ask Rax Tech’s agent, or drop an RFQ…', 'What is our win rate on banking bids?', 'Which tenders close this week?'], 2600);
}

function typeLoop(el, phrases, hold) {
  if (!el) return;
  if (reduce) { el.textContent = phrases[0]; return; }
  let i = 0;
  const run = () => {
    const text = phrases[i % phrases.length];
    let c = 0;
    const tick = setInterval(() => {
      el.textContent = text.slice(0, ++c);
      if (c >= text.length) { clearInterval(tick); setTimeout(() => { i += 1; run(); }, hold); }
    }, 38);
  };
  run();
}

function floatCard() {
  const box = $('#v-float');
  if (!box) return;
  const spots = [[16, 22], [62, 14], [38, 40], [78, 46], [12, 62], [54, 66], [84, 20], [28, 12]];
  box.innerHTML = CONNECTORS.slice(0, spots.length).map((c, i) => `<span class="float" style="left:${spots[i][0]}%;top:${spots[i][1]}%;animation-delay:-${i * 0.9}s">${brandTileHTML(c.brand, 36)}</span>`).join('');
}

function caps() {
  const list = $('#caps');
  const panel = $('#ans');
  if (!list || !panel) return;
  const show = (i) => {
    const c = CAPS[i];
    list.querySelectorAll('li').forEach((li, j) => { li.classList.toggle('on', j === i); li.setAttribute('aria-selected', String(j === i)); });
    panel.innerHTML = `<div class="body">
      <div class="q msg"><span class="av you">R</span><div><div class="name">Reena</div><div class="txt">${esc(c.q)}</div></div></div>
      <div class="msg"><span class="av bot ag-bot"><img src="/assets/brand/customers/rax-tech.png" alt="" /></span><div>
        <div class="name">Rax Tech’s agent</div><div class="done-row">Completed ${c.src.length + 2} actions ${icon('chev', 13).outerHTML}</div>
        <div class="txt">${cites(c.a)}</div>
        <div class="srcs">${c.src.length} source${c.src.length > 1 ? 's' : ''} used ${c.src.map(mark).join('')}</div>
        <div class="action-req"><span class="label">${icon('paper', 15).outerHTML}${esc(c.act)}</span><span class="small ink2" style="margin-right:6px">See details</span><button class="btn btn-secondary btn-xs" type="button">Reject</button><button class="btn btn-primary btn-xs" type="button">Confirm</button></div>
      </div></div></div>
      <div class="ans-foot"><span class="mono">${String(i + 1).padStart(2, '0')} / ${CAPS.length}</span><span class="ans-bar"><i style="width:${((i + 1) / CAPS.length) * 100}%"></i></span>
        <button class="btn btn-ghost btn-xs" type="button" data-step="-1" aria-label="Previous step"${i === 0 ? ' disabled' : ''}>${icon('chev', 14).outerHTML}</button><button class="btn btn-secondary btn-xs" type="button" data-step="1"${i === CAPS.length - 1 ? ' disabled' : ''}>Next${icon('chev', 14).outerHTML}</button></div>`;
    panel.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => show(i + Number(b.dataset.step))));
  };
  list.setAttribute('role', 'tablist');
  list.innerHTML = CAPS.map((c, i) => `<li role="tab" tabindex="0">${esc(c.t)}<span class="mono">${String(i + 1).padStart(2, '0')}</span></li>`).join('');
  list.querySelectorAll('li').forEach((li, i) => {
    li.addEventListener('click', () => show(i));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(i); } });
  });
  show(0);
}

function logoWall() {
  const wall = $('#logowall');
  if (!wall) return;
  wall.innerHTML = CONNECTORS.map((c) => `<div class="lw">
    ${logo(c, 32)}
    <div><div class="nm">${esc(c.name)}</div><div class="rl">${esc(c.role)}</div></div>
  </div>`).join('');
}

function tiles(id, items) {
  const box = document.getElementById(id);
  if (!box) return;
  box.innerHTML = items.map((x) => `<div class="tile reveal"><div class="in">
    <span class="appico">${logo(x, 44)}</span>
    <div class="nm">${esc(x.name)}${x.sub ? ` <span class="muted" style="font-weight:510">${esc(x.sub)}</span>` : ''}</div>
    <div class="rl">${esc(x.role)}</div></div></div>`).join('');
}

/** Static marks in the HTML: data-brand → real brand tile, data-mark → icon tile. */
function staticMarks() {
  document.querySelectorAll('[data-brand]').forEach((el) => el.replaceWith(brandTile(el.dataset.brand, el.classList.contains('inline-brand') ? 18 : 16)));
  document.querySelectorAll('[data-mark]').forEach((el) => { el.outerHTML = iconTile(el.dataset.mark, 16); });
}

function reveal() {
  const els = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in-view')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('in-view'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
}

staticMarks();
fillIcons();
nav();
heroReveal();
typeLoop($('#v-type'), ['Write the Kurinji Bank proposal', 'Can we meet the 72-hour battery backup?', 'Place the devices on the branch plan'], 2200);
floatCard();
caps();
logoWall();
tiles('models-tiles', MODELS);
tiles('agents', AGENTS);
fillIcons();
reveal();
