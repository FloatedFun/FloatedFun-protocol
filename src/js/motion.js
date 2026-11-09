// Motion toolkit. Spring constants measured from the reference bundle: (60,16) (170,15) (260,28).
export const reduced = () => !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);

// Damped harmonic oscillator, semi-implicit Euler at 1/240s. Returns progress samples at 60fps.
export function springSamples({ stiffness = 170, damping = 16, mass = 1, maxSeconds = 2.5 } = {}) {
  const h = 1 / 240; let x = 0, v = 0, t = 0; const out = [0];
  let n = 0;
  while (t < maxSeconds) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * h; x += v * h; t += h; n++;
    if (n % 4 === 0) { out.push(x); if (Math.abs(x - 1) < 0.0008 && Math.abs(v) < 0.002) break; }
  }
  out.push(1);
  return out;
}
export const springDuration = (samples) => Math.round((samples.length - 1) * (1000 / 60));

const cache = new Map();
function samplesFor(k) { const key = k.stiffness + ':' + k.damping; if (!cache.has(key)) cache.set(key, springSamples(k)); return cache.get(key); }

// Spring-driven entrance: translate + blur + opacity.
export function springIn(el, { delay = 0, y = 28, blur = 6, stiffness = 170, damping = 18 } = {}) {
  if (reduced() || !el.animate) { el.classList.add('is-in'); return Promise.resolve(); }
  const s = samplesFor({ stiffness, damping });
  const frames = s.map((p, i) => ({
    offset: i / (s.length - 1),
    opacity: Math.max(0, Math.min(1, p * 1.4)),
    transform: `translate3d(0, ${((1 - p) * y).toFixed(2)}px, 0)`,
    filter: `blur(${(Math.max(0, 1 - p * 1.3) * blur).toFixed(2)}px)`,
  }));
  const a = el.animate(frames, { duration: springDuration(s), delay, fill: 'backwards', easing: 'linear' });
  el.classList.add('is-in');
  return a.finished.catch(() => {});
}

export function initReveal(root = document) {
  const els = [...root.querySelectorAll('.reveal:not(.is-in)')];
  if (reduced() || !('IntersectionObserver' in globalThis)) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => {
    const vis = entries.filter((e) => e.isIntersecting);
    vis.forEach((e, i) => { io.unobserve(e.target); springIn(e.target, { delay: i * 70 }); });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

// Count-up. Eases with the same spring family, flashes on a changed value.
export function countTo(el, to, fmt, { from, duration = 700 } = {}) {
  if (to == null || !isFinite(to)) { el.textContent = fmt(null); return; }
  const prev = from != null ? from : Number(el.dataset.v);
  el.dataset.v = String(to);
  if (reduced() || !isFinite(prev) || prev === to) { el.textContent = fmt(to); return; }
  const dir = to > prev ? 'up' : 'down';
  el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add('flash-' + dir);
  const s = samplesFor({ stiffness: 260, damping: 28 }); const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / duration); const p = s[Math.min(s.length - 1, Math.round(k * (s.length - 1)))];
    el.textContent = fmt(prev + (to - prev) * p);
    if (k < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

export function initProgress(bar) {
  let q = false;
  const upd = () => { q = false; const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`; };
  addEventListener('scroll', () => { if (!q) { q = true; requestAnimationFrame(upd); } }, { passive: true });
  upd();
}

export function initSpotlight() {
  addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
  }, { passive: true });
}

// Hero parallax: pointer + scroll, eased with a damped follow.
export function initParallax(hero) {
  if (reduced()) return;
  const layers = [...hero.querySelectorAll('[data-depth]')];
  let tx = 0, ty = 0, cx = 0, cy = 0, vx = 0, vy = 0, raf = 0, on = true;
  addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on && !raf) raf = requestAnimationFrame(loop); }).observe(hero);
  function loop() {
    raf = 0; if (!on) return;
    const k = 90, d = 14, dt = 1 / 60;
    vx += (-k * (cx - tx) - d * vx) * dt; vy += (-k * (cy - ty) - d * vy) * dt; cx += vx * dt; cy += vy * dt;
    const sy = Math.min(scrollY, innerHeight);
    for (const l of layers) {
      const z = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${(cx * z * 26).toFixed(2)}px, ${(cy * z * 16 + sy * z * 0.22).toFixed(2)}px, 0)`;
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
}

// Layered sine water. Colours come from CSS custom properties, never literals.
export function initWater(canvas) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const cs = getComputedStyle(document.documentElement);
  const rgb = (n) => cs.getPropertyValue(n).trim();
  const layers = [
    { c: rgb('--c-line-rgb'), a: 0.55, amp: 0.16, f: 1.1, s: 0.35, y: 0.30 },
    { c: rgb('--c-float-rgb'), a: 0.38, amp: 0.12, f: 1.7, s: -0.5, y: 0.45 },
    { c: rgb('--c-float-2-rgb'), a: 0.28, amp: 0.09, f: 2.6, s: 0.8, y: 0.62 },
    { c: rgb('--c-foam-rgb'), a: 0.5, amp: 0.05, f: 3.4, s: -1.1, y: 0.78, line: true },
  ];
  let w = 0, h = 0, on = true, raf = 0;
  const fit = () => { const d = Math.min(2, devicePixelRatio || 1); w = canvas.clientWidth; h = canvas.clientHeight; canvas.width = w * d; canvas.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
  fit(); addEventListener('resize', () => { fit(); draw(performance.now()); });
  function draw(now) {
    ctx.clearRect(0, 0, w, h); const t = now / 1000;
    for (const L of layers) {
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const y = h * L.y + Math.sin(x / w * Math.PI * 2 * L.f + t * L.s) * h * L.amp * 0.5 + Math.sin(x / w * Math.PI * 5 * L.f - t * L.s * 1.7) * h * L.amp * 0.18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath();
      if (L.line) { ctx.strokeStyle = `rgb(${L.c} / ${L.a})`; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { const g = ctx.createLinearGradient(0, h * L.y - h * L.amp, 0, h); g.addColorStop(0, `rgb(${L.c} / ${L.a})`); g.addColorStop(1, `rgb(${L.c} / 0)`); ctx.fillStyle = g; ctx.fill(); }
    }
  }
  const loop = (now) => { raf = 0; if (!on || document.hidden) return; draw(now); raf = requestAnimationFrame(loop); };
  if (reduced()) { draw(0); return; }
  new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on && !raf) raf = requestAnimationFrame(loop); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf) raf = requestAnimationFrame(loop); });
  raf = requestAnimationFrame(loop);
}
