import { isStated, fmtUsd, fmtPrice, fmtPct } from './register.js';
import { loadTrending, createPoller } from './market.js';
import { loadOwn, FALLBACK_LOGO } from './own.js';
import { reduced, initReveal, initProgress, initSpotlight, initParallax, initWater, countTo } from './motion.js';

const PLACEHOLDER_DOTS = '· · · · ·';
const BRAND_LOGO = 'brand/floated-logo.png';
const TREND_ROWS = 9;

export function boot(env = {}) {
  const doc = env.document || document;
  const fetchFn = env.fetch || ((...a) => globalThis.fetch(...a));
  const log = env.log || console.log;
  const reg = JSON.parse(doc.getElementById('register').textContent);
  const R = reg.records;
  const caStated = isStated(R.ca);
  const ca = caStated ? R.ca.value : null;
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => [...r.querySelectorAll(s)];

  const state = { trending: null, own: null, tab: 'volume', status: 'loading', everLoaded: false };

  // ---------- copy ----------
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      try { const t = doc.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; doc.body.appendChild(t); t.select(); const ok = doc.execCommand('copy'); t.remove(); return ok; } catch { return false; }
    }
  }
  const live = $('#live-msg');
  function flashCopied(btn, hint) {
    btn.classList.add('copied');
    if (hint) { hint.dataset.prev = hint.dataset.prev || hint.textContent; hint.textContent = 'Copied'; }
    if (live) live.textContent = 'Copied';
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.classList.remove('copied'); if (hint) hint.textContent = hint.dataset.prev; if (live) live.textContent = ''; }, 1400);
  }
  doc.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    if (await copyText(b.dataset.copy)) flashCopied(b, b.querySelector('[data-hint]'));
  });

  // ---------- tiles ----------
  function tile(row) {
    const t = doc.createElement('span'); t.className = 'tile';
    const letters = (row.symbol || '?').replace(/[^A-Za-z0-9]/g, '');
    const letter = () => { t.replaceChildren(); t.classList.add('tile-letter'); t.textContent = (letters.length >= 2 ? letters.slice(0, 2) : letters || '?').toUpperCase(); };
    if (row.logoOverride) { const i = doc.createElement('img'); i.src = row.logoOverride; i.alt = ''; i.width = 40; i.height = 40; i.decoding = 'async'; t.appendChild(i); return t; }
    if (!row.logo && !row.own) { letter(); return t; }
    const img = doc.createElement('img'); img.alt = ''; img.width = 40; img.height = 40; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    if (row.own) {
      img.addEventListener('error', () => { if (img.getAttribute('src') !== FALLBACK_LOGO) img.src = FALLBACK_LOGO; });
      img.src = row.logo || FALLBACK_LOGO; t.appendChild(img); return t;
    }
    // Letter tile is the base layer; the remote logo fades in over it once it loads, and is dropped if it fails.
    t.classList.add('tile-letter'); t.textContent = (letters.length >= 2 ? letters.slice(0, 2) : letters || '?').toUpperCase();
    img.className = 'tile-img';
    img.addEventListener('load', () => img.classList.add('ok'));
    img.addEventListener('error', () => img.remove());
    img.src = row.logo; t.appendChild(img); return t;
  }

  // ---------- board ----------
  const rowsEl = $('#rows');
  const COLS = ['price', 'chg', 'vol', 'liq'];
  function skeletonRow(i) {
    const li = doc.createElement('li'); li.className = 'row spot is-skel'; li.dataset.i = String(i);
    li.innerHTML = '<span class="rk"></span><div class="tok"><span class="tile sk"></span><div class="tn"><span class="sk sk-a"></span><span class="sk sk-b"></span></div></div><span class="c price sk-c" data-label="Price"><span class="sk sk-c1"></span></span><span class="c chg sk-c" data-label="24h"><span class="sk sk-c1"></span></span><span class="c vol sk-c" data-label="Volume"><span class="sk sk-c1"></span></span><span class="c liq sk-c" data-label="Liquidity"><span class="sk sk-c1"></span></span><span class="cpy-slot"></span>';
    $('.rk', li).textContent = String(i + 1);
    return li;
  }
  const rowsInit = () => { rowsEl.replaceChildren(...Array.from({ length: TREND_ROWS + 1 }, (_, i) => skeletonRow(i))); };
  rowsInit();

  function setText(el, v, fmt, key, addr) {
    const same = el.dataset.addr === addr;
    el.dataset.addr = addr || '';
    el.classList.remove('sk-c'); el.classList.remove('na');
    if (v == null) { el.textContent = '—'; el.classList.add('na'); delete el.dataset.v; return; }
    if (same) countTo(el, v, fmt); else { el.dataset.v = String(v); el.textContent = fmt(v); }
  }

  function fillRow(li, r, i) {
    const wasSkel = li.classList.contains('is-skel');
    const addr = r.address;
    li.classList.remove('is-skel', 'own', 'placeholder'); li.removeAttribute('aria-hidden');
    if (r.own) li.classList.add('own');
    if (r.placeholder) li.classList.add('placeholder');
    $('.rk', li).textContent = String(i + 1);
    const tok = $('.tok', li);
    if (li.dataset.key !== (r.placeholder ? 'ph' : addr)) {
      tok.replaceChildren(tile(r.placeholder ? { logoOverride: BRAND_LOGO, symbol: 'FL' } : r));
      const tn = doc.createElement('div'); tn.className = 'tn';
      const sym = doc.createElement('b'); sym.className = 'sym'; sym.textContent = r.placeholder ? 'FLOATED' : (r.symbol || '—');
      const nm = doc.createElement('span'); nm.className = 'nm'; nm.textContent = r.placeholder ? 'awaiting contract' : (r.name || '');
      tn.append(sym, nm); tok.appendChild(tn);
      li.dataset.key = r.placeholder ? 'ph' : addr;
    }
    const price = $('.price', li), chg = $('.chg', li), vol = $('.vol', li), liq = $('.liq', li);
    if (r.placeholder) {
      price.textContent = '$0.00'; for (const el of [chg, vol, liq]) el.textContent = PLACEHOLDER_DOTS;
      for (const el of [price, chg, vol, liq]) el.classList.remove('sk-c', 'na');
      li.setAttribute('aria-disabled', 'true');
    } else {
      setText(price, r.price, fmtPrice, 'p', addr);
      setText(chg, r.change, fmtPct, 'c', addr);
      chg.classList.toggle('up', r.change > 0); chg.classList.toggle('down', r.change < 0);
      setText(vol, r.volume, fmtUsd, 'v', addr);
      setText(liq, r.liquidity, fmtUsd, 'l', addr);
      liq.title = r.liquidityLabel === 'Mkt Cap' ? 'Mkt Cap' : '';
      liq.dataset.label = r.liquidityLabel === 'Mkt Cap' ? 'Mkt Cap' : 'Liquidity';
    }
    const slot = $('.cpy-slot', li) || $('.cpy', li)?.parentNode;
    if (slot) {
      slot.replaceChildren();
      if (!r.placeholder && addr) {
        const b = doc.createElement('button'); b.type = 'button'; b.className = 'cpy'; b.dataset.copy = addr; b.setAttribute('aria-label', 'Copy address of ' + (r.symbol || 'token'));
        b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path class="i-copy" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 9h10v10H9zM5 15V5h10"/><path class="i-ok" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
        slot.appendChild(b);
      }
    }
    if (wasSkel && !reduced()) { li.style.setProperty('--d', (i * 45) + 'ms'); li.classList.add('fade-in'); setTimeout(() => li.classList.remove('fade-in'), 900 + i * 45); }
  }

  function sorted(list) {
    const m = { volume: (r) => r.volume || 0, movers: (r) => Math.abs(r.change || 0), depth: (r) => r.liquidity || 0 }[state.tab];
    return [...list].sort((a, b) => m(b) - m(a));
  }
  function currentRows() {
    const first = caStated ? (state.own || { own: true, address: ca, symbol: '', name: '', price: null, change: null, volume: null, liquidity: null, liquidityLabel: 'Liquidity', logo: null, pending: true }) : { placeholder: true, own: true, address: '' };
    const trend = (state.trending || []).filter((r) => r.address !== ca);
    return { first, trend: sorted(trend).slice(0, TREND_ROWS) };
  }
  function renderBoard() {
    const { first, trend } = currentRows();
    const lis = $$('li.row', rowsEl);
    if (state.trending || state.own || !caStated) {
      if (first.pending && !state.own) { /* own data still loading: keep skeleton cells under pinned identity */ }
      fillRow(lis[0], first, 0);
      if (first.pending) { for (const k of COLS) { const el = $('.' + k, lis[0]); el.classList.add('sk-c'); el.innerHTML = '<span class="sk sk-c1"></span>'; } }
    } else { fillRow(lis[0], first, 0); }
    if (state.trending) trend.forEach((r, i) => fillRow(lis[i + 1], r, i + 1));
    renderTicker(first, trend); renderStats(trend);
  }

  // ---------- ticker ----------
  const track = $('#ticker-track');
  function tkItem(r, ph) {
    const s = doc.createElement('span'); s.className = 'tk';
    const t = ph ? tile({ logoOverride: BRAND_LOGO, symbol: 'FL' }) : tile(r); t.classList.add('tile-s'); s.appendChild(t);
    const b = doc.createElement('b'); b.textContent = ph ? 'FLOATED' : r.symbol; s.appendChild(b);
    const p = doc.createElement('span'); p.className = 'tk-p'; p.textContent = ph ? '$0.00' : fmtPrice(r.price); s.appendChild(p);
    const c = doc.createElement('span'); c.className = 'tk-c ' + (r.change > 0 ? 'up' : r.change < 0 ? 'down' : ''); c.textContent = ph ? '· · ·' : fmtPct(r.change); s.appendChild(c);
    return s;
  }
  function renderTicker(first, trend) {
    if (!track) return;
    const items = [];
    if (first && (first.placeholder || (first.price != null))) items.push(tkItem(first, first.placeholder));
    for (const r of trend) items.push(tkItem(r));
    if (items.length < 2) return;
    const mk = (hidden) => { const g = doc.createElement('div'); g.className = 'tk-set'; if (hidden) g.setAttribute('aria-hidden', 'true'); items.forEach((n) => g.appendChild(hidden ? n.cloneNode(true) : n)); return g; };
    track.replaceChildren(mk(false), mk(true), mk(true), mk(true));
    track.classList.remove('is-skel'); track.classList.add('ready');
  }

  // ---------- stats ----------
  function renderStats(trend) {
    const n = $('#stat-count'), v = $('#stat-vol');
    if (!state.trending) return;
    n.textContent = String(trend.length + 1); n.classList.remove('sk-c');
    const total = trend.reduce((s, r) => s + (r.volume || 0), 0) + ((state.own && state.own.volume) || 0);
    v.classList.remove('sk-c'); countTo(v, total, fmtUsd);
  }

  // ---------- status ----------
  const pill = $('#status-pill'), pillText = $('#status-text'), err = $('#board-error');
  function setStatus(s) {
    state.status = s;
    const label = { loading: 'Syncing', live: 'Live', retry: state.everLoaded ? 'Stale, retrying' : 'Feed offline, retrying', paused: 'Paused' }[s] || s;
    if (pillText) pillText.textContent = label;
    if (pill) pill.dataset.state = s === 'retry' ? (state.everLoaded ? 'stale' : 'error') : s;
    if (err) err.hidden = !(s === 'retry' && !state.everLoaded);
  }

  // ---------- data ----------
  const src = R['market-source'];
  const poller = createPoller({
    doc,
    task: async () => {
      const [trending, own] = await Promise.all([
        loadTrending(fetchFn, src, { limit: 12 }),
        caStated ? loadOwn(fetchFn, src, ca, log).catch(() => state.own) : Promise.resolve(null),
      ]);
      return { trending, own };
    },
    onData: ({ trending, own }) => { state.trending = trending; if (own) state.own = own; state.everLoaded = true; renderBoard(); },
    onError: (e) => { log('[floated] market fetch failed', String(e && e.message || e)); if (!state.everLoaded) showDash(); },
    onState: setStatus,
  });
  function showDash() {
    $$('li.row.is-skel', rowsEl).forEach((li) => {
      $$('.c', li).forEach((c) => { c.classList.remove('sk-c'); c.classList.add('na'); c.textContent = '—'; });
      $$('.sk', li).forEach((s) => { if (s.closest('.tn')) s.remove(); });
    });
  }
  if (!caStated) { renderBoard(); }

  // ---------- tabs ----------
  const tabs = $$('#board-tabs [role="tab"]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    state.tab = t.dataset.sort; if (state.trending) renderBoard();
  }));
  $('#board-tabs')?.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(doc.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
    if (j >= 0) { tabs[j].focus(); tabs[j].click(); e.preventDefault(); }
  });

  // ---------- method steps ----------
  const steps = $$('#steps [role="tab"]'), panels = $$('#steps [role="tabpanel"]');
  let cur = 0, auto = !reduced(), stepTimer = null;
  function showStep(i) {
    cur = i;
    steps.forEach((s, k) => { s.setAttribute('aria-selected', String(k === i)); s.tabIndex = k === i ? 0 : -1; s.classList.toggle('done', k < i); });
    panels.forEach((p, k) => { p.hidden = k !== i; });
    const bar = $('#steps .fill'); if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = auto ? 'stepfill 6s linear forwards' : 'none'; bar.style.width = auto ? '' : '100%'; }
  }
  function loopSteps() { clearTimeout(stepTimer); if (auto) stepTimer = setTimeout(() => { showStep((cur + 1) % steps.length); loopSteps(); }, 6000); }
  steps.forEach((s, k) => s.addEventListener('click', () => { auto = false; clearTimeout(stepTimer); showStep(k); }));
  if (steps.length) { showStep(0); loopSteps(); }

  // ---------- effects ----------
  if (env.effects !== false) {
    const bar = $('#progress'); if (bar) initProgress(bar);
    initSpotlight(); initReveal(doc);
    const hero = $('#hero'); if (hero) initParallax(hero);
    const water = $('#water'); if (water) initWater(water);
    $$('.word').forEach((w, i) => w.style.setProperty('--reveal-delay', (0.1 + i * 0.08).toFixed(2) + 's'));
  } else { $$('.reveal').forEach((e) => e.classList.add('is-in')); }

  setStatus('loading');
  poller.start();
  return { state, poller, renderBoard, fillRow };
}

if (typeof window !== 'undefined' && !globalThis.__FLOATED_TEST__ && document.getElementById('register')) boot();
