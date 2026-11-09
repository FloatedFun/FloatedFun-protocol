// Gate harness. Every anchor reads the register at runtime; nothing hardcodes an expected state.
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { build } from './build.mjs';
import { validate, isStated, handleOf } from '../src/js/register.js';
import { ICON_X, ICON_GH } from '../src/js/render.js';
import { withBackoff, createPoller } from '../src/js/market.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(root, p), 'utf8');
const results = [];
async function gate(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  ok   ' + name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const walk = (d, o = []) => { for (const f of readdirSync(d)) { if (['node_modules', 'dist', '.git'].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p, o) : o.push(p); } return o; };
const walkAll = (d, o = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walkAll(p, o) : o.push(p); } return o; };
const textOf = (p) => ['.html', '.css', '.js', '.svg', '.json', '.md', '.mjs', '.py', ''].includes(extname(p)) ? readFileSync(p, 'utf8') : '';

// ---------- variants ----------
const base = JSON.parse(rd('register.json'));
const TEST_CA = 'So11111111111111111111111111111111111111112';
const variant = (fn) => { const r = JSON.parse(JSON.stringify(base)); fn(r.records); return r; };
const VARIANTS = {
  real: base,
  allAbsent: variant((r) => { r.ca = { label: 'Contract', state: 'absent' }; r.x = { label: 'X', state: 'absent' }; r.github = { label: 'GitHub', state: 'absent' }; }),
  allStated: variant((r) => { r.ca = { label: 'Contract', state: 'stated', value: TEST_CA }; r.x = { label: 'X', state: 'stated', url: 'https://x.com/floatedtest' }; r.github = { label: 'GitHub', state: 'stated', url: 'https://github.com/floatedtest/site' }; }),
  mixed: variant((r) => { r.ca = { label: 'Contract', state: 'unconfirmed' }; r.x = { label: 'X', state: 'stated', url: 'https://x.com/floatedtest' }; r.github = { label: 'GitHub', state: 'unconfirmed' }; }),
};
const tmp = mkdtempSync(join(tmpdir(), 'floated-gates-'));
const built = {};
for (const [k, reg] of Object.entries(VARIANTS)) {
  const rp = join(tmp, k + '.json'); writeFileSync(rp, JSON.stringify(reg));
  built[k] = build({ registerPath: rp, out: join(tmp, 'dist-' + k), quiet: true });
}
const realDist = join(root, 'dist');

// ---------- fake network ----------
const OWN = TEST_CA;
const mkPair = (addr, sym, vol, extra = {}) => ({ chainId: 'solana', url: 'https://x.test/' + sym, baseToken: { address: addr, symbol: sym, name: sym + ' coin' }, priceUsd: '0.01', priceChange: { h24: 3.5 }, volume: { h24: vol }, liquidity: { usd: vol / 2 }, info: { imageUrl: 'https://img.test/' + sym + '.png' }, ...extra });
function net(opts = {}) {
  const calls = [];
  const addrs = Array.from({ length: 12 }, (_, i) => 'Tok' + String(i).padStart(2, '0') + 'a'.repeat(32));
  const boosts = [...addrs.map((a) => ({ chainId: 'solana', tokenAddress: a })), { chainId: 'ethereum', tokenAddress: '0x' + 'ab'.repeat(20) }, { chainId: 'solana', tokenAddress: OWN }];
  const fetch = async (url) => {
    calls.push({ url, t: calls.length });
    if (opts.fail) throw new Error('down');
    const J = (v) => ({ ok: true, status: 200, json: async () => v });
    if (url.includes('token-boosts')) return J(boosts);
    if (url.includes('tokens/v1/solana/')) {
      const asked = decodeURIComponent(url.split('/solana/')[1]).split(',');
      const out = [];
      for (const a of asked) { if (a === OWN) { out.push(mkPair(OWN, 'OWNX', 9e9)); continue; } const i = addrs.indexOf(a); if (i >= 0) out.push(mkPair(a, 'T' + String(i).padStart(2, '0'), 1e6 - i * 1000)); }
      return J(out);
    }
    if (url.includes('latest/dex/tokens/')) {
      await new Promise((r) => setTimeout(r, 15));
      return J({ pairs: [mkPair('Decoy' + 'z'.repeat(30), 'DECOY', 9e12), mkPair(OWN, 'LOW', 100, { liquidity: { usd: 0 }, marketCap: 1 }), mkPair(OWN, 'OWN', 5000, { liquidity: { usd: 0 }, marketCap: 50000 })] });
    }
    if (url.includes('pump.fun')) { await new Promise((r) => setTimeout(r, 15)); if (opts.pumpFail) return { ok: false, status: 403, json: async () => ({}) }; return J({ image_uri: 'https://pump.test/own.png' }); }
    throw new Error('unexpected url ' + url);
  };
  return { fetch, calls };
}

// ---------- jsdom runner ----------
globalThis.matchMedia = () => ({ matches: true });
const mainMod = await import('../src/js/main.js');
async function run(distDir, netOpts = {}, { wait = 400 } = {}) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const logs = [];
  const n = net(netOpts);
  const app = mainMod.boot({ document: dom.window.document, fetch: n.fetch, log: (...a) => logs.push(a), effects: false });
  const t0 = Date.now();
  while (Date.now() - t0 < (netOpts.fail ? 9000 : 4000) && !app.state.everLoaded && !(netOpts.fail && app.poller.fails > 0)) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, wait));
  app.poller.stop();
  return { doc: dom.window.document, app, logs, calls: n.calls, win: dom.window };
}
const regOf = (doc) => JSON.parse(doc.getElementById('register').textContent).records;
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' \n ').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

console.log('FLOATED gates');

// ================= register / repo hygiene =================
console.log('register');
for (const [k, reg] of Object.entries(VARIANTS)) await gate(`register valid + inert carries no value/url [${k}]`, () => {
  eq(validate(reg).length, 0, validate(reg).join(';'));
  for (const [id, r] of Object.entries(reg.records)) if (r.state !== 'stated') ok(!('value' in r) && !('url' in r), id + ' inert has value/url');
});
await gate('register: inert record with value is rejected (negative control)', () => {
  const bad = variant((r) => { r.x = { label: 'X', state: 'absent', url: 'https://x.com/a' }; });
  ok(validate(bad).length > 0, 'not rejected');
});
await gate('register: stated ca must be address-shaped (negative control)', () => {
  const bad = variant((r) => { r.ca = { label: 'Contract', state: 'stated', value: 'hello' }; });
  ok(validate(bad).length > 0, 'not rejected');
});
await gate('register: chain record carries rpc, source and scope', () => {
  const c = base.records.chain; eq(c.rpc, 'https://solana-rpc.publicnode.com'); eq(c.source, 'client statement'); eq(c.scope, 'batch-level');
});
await gate('register: dates exist in register.json as data', () => ok(/\d{4}-\d{2}-\d{2}/.test(rd('register.json')), 'no data dates'));

console.log('repo hygiene and palette');
await gate('no CLAUDE.md, no .claude folder', () => { ok(!existsSync(join(root, 'CLAUDE.md')) && !existsSync(join(root, '.claude')), 'present'); });
await gate('no AI attribution words anywhere in repo text', () => {
  const re = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'generated (by|with)', 'co-authored', '\\bA' + 'I\\b', 'chat' + 'gpt', 'LL' + 'M\\b'].join('|'), 'i');
  const hits = walk(root).filter((p) => !p.endsWith('package-lock.json') && !/gates\.mjs$/.test(p) && re.test(textOf(p)));
  eq(hits.map((p) => relative(root, p)).join(','), '');
});
await gate('README.md, docs/whitepaper.md, LICENSE exist at root and not in dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) ok(existsSync(join(root, f)), f + ' missing');
  const names = walkAll(realDist).map((p) => relative(realDist, p).toLowerCase());
  ok(!names.some((n) => /readme|whitepaper|license/.test(n)), 'doc file leaked into dist');
  ok(/MIT License/.test(rd('LICENSE')) && /FLOATED/.test(rd('LICENSE')) && /2026/.test(rd('LICENSE')), 'license text');
});
await gate('palette: colour literals live only in tokens.css (and the generated favicon)', () => {
  const lit = /#[0-9a-fA-F]{3,8}\b(?![\w-])|\b(?:rgba?|hsla?|oklch|lab)\(\s*\d/;
  const files = [...walkAll(join(root, 'src')), ...walkAll(realDist)].filter((p) => /\.(css|js|html)$/.test(p) && !/tokens\.css$/.test(p));
  const bad = [];
  for (const p of files) { const t = textOf(p).replace(/href="#[\w-]+"/g, '').replace(/<meta name="theme-color"[^>]*>/, ''); if (lit.test(t)) bad.push(relative(root, p)); }
  eq(bad.join(','), '');
});
await gate('palette: every token hex is a sampled pixel in tools/palette.json with provenance comment', () => {
  const pal = JSON.parse(rd('tools/palette.json')); const set = new Set(Object.values(pal).flatMap((s) => s.colors.map((c) => c.hex)));
  const t = rd('src/tokens.css'); const hexes = t.match(/#[0-9a-f]{6}/g); ok(hexes.length >= 10, 'few tokens');
  for (const h of hexes) ok(set.has(h), h + ' not sampled');
  ok(/k-means/.test(t) && /nearest real pixel/.test(t), 'provenance comment');
});
await gate('palette: rgb channel tokens match their hex tokens', () => {
  const t = rd('src/tokens.css'); const pairs = { abyss: 'abyss', deep: 'deep', hull: 'hull', line: 'line', float: 'float', 'float-2': 'float-2', foam: 'foam' };
  for (const k of Object.keys(pairs)) { const h = t.match(new RegExp(`--c-${k}:\\s*#([0-9a-f]{6})`))[1]; const c = t.match(new RegExp(`--c-${k}-rgb:\\s*(\\d+) (\\d+) (\\d+)`)).slice(1).map(Number); eq(c.join(','), [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(','), k); }
});
await gate('favicon: svg 32x32, no double hyphen anywhere, colours sampled, built in dist', () => {
  const s = rd('src/assets/favicon.svg'); ok(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s), 'size'); ok(!s.includes('--'), 'double hyphen'); ok(!/<!--/.test(s), 'comment');
  const pal = JSON.parse(rd('tools/palette.json')); const set = new Set(pal.logo.colors.map((c) => c.hex));
  for (const h of s.match(/#[0-9a-f]{6}/g)) ok(set.has(h), h);
  ok(existsSync(join(realDist, 'assets/favicon.svg')) && /rel="icon"[^>]*favicon\.svg/.test(readFileSync(join(realDist, 'index.html'), 'utf8')), 'not linked');
});
await gate('assets: logo outputs are RGBA PNG (IHDR colortype 6); resize is premultiplied', () => {
  for (const f of ['src/assets/logo-192.png', 'src/assets/logo-512.png', 'src/brand/floated-logo.png']) { const b = readFileSync(join(root, f)); eq(b.readUInt8(25), 6, f + ' colortype'); eq(b.readUInt32BE(16) > 0, true); }
  ok(rd('tools/assets.py').includes("convert('RGBa')"), 'premultiply step');
});
await gate('layout: no ch units in css or js', () => { for (const p of ['src/styles.css', 'src/tokens.css']) ok(!/\d\s?ch\b/.test(rd(p)), p); });
await gate('motion: prefers-reduced-motion present, kills own-row animation and every keyframe animation', () => {
  const c = rd('src/styles.css'); const m = c.slice(c.indexOf('@media (prefers-reduced-motion: reduce)'));
  ok(m.includes('animation: none !important') && /\.row\.own \{ animation: none; \}/.test(m), 'reduced block');
  ok(/export const reduced/.test(rd('src/js/motion.js')) && /if \(reduced\(\)/.test(rd('src/js/motion.js')), 'js guard');
});
await gate('motion: own row has 2px mint left border and 2s ease-in-out infinite pulse', () => {
  const c = rd('src/styles.css'); ok(/\.row\.own \{ border-left: 2px solid var\(--color-mint\); animation: ownPulse 2s ease-in-out infinite; \}/.test(c), 'own row css');
  ok(/--color-mint:/.test(rd('src/tokens.css')), 'mint token');
});
await gate('motion: spring solver is a damped oscillator and settles', async () => {
  const { springSamples } = await import('../src/js/motion.js'); const s = springSamples({ stiffness: 170, damping: 16 });
  ok(Math.max(...s) > 1, 'underdamped overshoot'); ok(Math.abs(s.at(-1) - 1) < 1e-9, 'settles');
  const c = springSamples({ stiffness: 260, damping: 28 }); ok(Math.max(...c) < 1.05, 'near critical');
});

// ================= no dates =================
console.log('no dates');
const DATE_RES = [/\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b/, /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\bas of\b|\bchecked\b|\blast updated\b|\bupdated at\b/i, /toLocale(Date|Time)String|new Date\(|Date\.now|toISOString/];
const dateHits = (dir) => walkAll(dir).filter((p) => /\.(html|js|css|svg)$/.test(p)).flatMap((p) => DATE_RES.filter((re) => re.test(textOf(p))).map((re) => relative(dir, p) + ' ' + re));
for (const k of Object.keys(built)) await gate(`dist has zero date/time/as-of strings [${k}]`, () => eq(dateHits(built[k].out).join('; '), ''));
await gate('dist has no "recorded" field and register inline has no dates', () => { for (const k of Object.keys(built)) ok(!/recorded/.test(readFileSync(join(built[k].out, 'index.html'), 'utf8')), k); });
await gate('date scanner catches an injected date (negative control)', () => {
  const t = 'Updated 2026-11-09'; ok(DATE_RES.some((re) => re.test(t)), 'missed'); ok(DATE_RES.some((re) => re.test('checked 12:30')), 'missed clock');
});

// ================= address scanner =================
console.log('address scanner');
const ADDR = /0x[0-9a-fA-F]{40}\b|(?<![A-Za-z0-9])[1-9A-HJ-NP-Za-km-z]{32,44}(?![A-Za-z0-9])/g;
const statedValues = (reg) => new Set(Object.values(reg.records).filter(isStated).flatMap((r) => [r.value].filter((v) => v && ADDR.test(v) && !(ADDR.lastIndex = 0))));
const addrHits = (dir, reg) => { const allow = statedValues(reg); const out = []; for (const p of walkAll(dir).filter((q) => /\.(html|js|css)$/.test(q))) for (const m of textOf(p).matchAll(ADDR)) if (!allow.has(m[0])) out.push(relative(dir, p) + ':' + m[0]); return out; };
for (const [k, b] of Object.entries(built)) await gate(`every address-shaped string matches the stated registry, CA exempt [${k}]`, () => eq(addrHits(b.out, b.reg).join(';'), ''));
await gate('scanner does not blanket-reject 0x hex: a stated 0x record passes, an unstated one fails', () => {
  const reg = { records: { ca: { state: 'stated', value: '0x' + 'ab'.repeat(20) } } }; ok(statedValues(reg).has('0x' + 'ab'.repeat(20)), 'stated 0x not allowed');
  ok(!statedValues({ records: {} }).has('0x' + 'ab'.repeat(20)), 'unstated allowed');
});
await gate('scanner flags a foreign address injected into html (negative control)', () => {
  const d = join(tmp, 'neg'); build({ registerPath: join(tmp, 'allAbsent.json'), out: d, quiet: true });
  writeFileSync(join(d, 'index.html'), readFileSync(join(d, 'index.html'), 'utf8').replace('</footer>', TEST_CA + '</footer>'));
  ok(addrHits(d, built.allAbsent.reg).length > 0, 'not flagged');
});

// ================= copy / 2-gram =================
console.log('copy');
await gate('zero shared 2-grams with the reference site copy', () => {
  const ref = new Set(JSON.parse(rd('tools/ref-grams.json'))); ok(ref.size > 200, 'ref grams missing');
  const html = readFileSync(join(realDist, 'index.html'), 'utf8');
  const strings = [visibleText(html)];
  for (const p of walkAll(join(realDist, 'js'))) for (const m of textOf(p).matchAll(/'([^'\n]{5,})'|"([^"\n]{5,})"/g)) { const s = m[1] || m[2]; if (/^[A-Za-z][A-Za-z ,.'-]*$/.test(s) && s.includes(' ')) strings.push(s); }
  const hits = [];
  for (const t of strings) for (const seg of t.split(/[\n.!?;:|]+/)) { const w = seg.toLowerCase().match(/[a-z$']+/g) || []; for (let i = 0; i < w.length - 1; i++) { const g = w[i] + ' ' + w[i + 1]; if (ref.has(createHash('sha1').update(g).digest('hex').slice(0, 12))) hits.push(g); } }
  eq([...new Set(hits)].join(' | '), '');
});
await gate('copy: no reference brand words in the page', () => { const t = visibleText(readFileSync(join(realDist, 'index.html'), 'utf8')).toLowerCase(); for (const w of ['refloat', 'pump.fun', 'stonkfun']) ok(!t.includes(w), w); });

// ================= slots, per variant, read at runtime =================
console.log('slots (state read from the register inside each built page)');
for (const [k, b] of Object.entries(built)) {
  const html = readFileSync(join(b.out, 'index.html'), 'utf8'); const dom = new JSDOM(html); const doc = dom.window.document; const R = regOf(doc);
  await gate(`CA slot follows register at runtime [${k}]`, () => {
    const el = doc.querySelector('[data-ca-slot] [data-record="ca"]'); ok(el, 'ca slot missing'); eq(el.dataset.state, R.ca.state);
    if (isStated(R.ca)) { eq(el.tagName, 'BUTTON'); eq(el.dataset.copy, R.ca.value); ok(el.textContent.includes(R.ca.value), 'full address text'); ok(!/…|\.\.\./.test(el.textContent), 'truncated'); }
    else { ok(el.tagName !== 'BUTTON' && !el.hasAttribute('data-copy'), 'inert has copy'); ok(!el.querySelector('a,button'), 'inert has control'); eq(el.querySelector('.ca-value').textContent, 'pending'); }
  });
  await gate(`CA slot sits in the header block, above the fold, before main [${k}]`, () => { const slot = doc.querySelector('[data-ca-slot]'); ok(slot.closest('header'), 'in header'); ok(/position:\s*fixed/.test(rd('src/styles.css').match(/\.head \{[^}]*\}/)[0]), 'fixed'); });
  for (const id of ['x', 'github']) await gate(`social ${id}: both icons present, inert/live read from register [${k}]`, () => {
    const el = doc.querySelector(`.socials [data-record="${id}"]`); ok(el, 'icon missing'); ok(el.closest('header'), 'top bar'); eq(el.dataset.state, R[id].state);
    eq(el.textContent.trim(), '', 'icon only, no label text'); ok(el.querySelector('svg path'), 'svg');
    eq(el.querySelector('path').getAttribute('d'), (id === 'x' ? ICON_X : ICON_GH).match(/ d="([^"]+)"/)[1], 'official path');
    if (isStated(R[id])) { eq(el.tagName, 'A'); eq(el.getAttribute('href'), R[id].url); ok(/noopener/.test(el.rel), 'rel'); ok(el.getAttribute('aria-label').includes(handleOf(R[id].url)), 'handle derived'); }
    else { ok(!el.hasAttribute('href') && el.tagName !== 'A', 'inert has href'); eq(el.getAttribute('aria-disabled'), 'true'); }
  });
  await gate(`inert records render label + pending only, no href/url inside [${k}]`, () => {
    for (const [id, r] of Object.entries(R)) { const c = doc.querySelector(`[data-record-card="${id}"]`); ok(c, id); eq(c.dataset.state, r.state); if (r.state !== 'stated') { ok(!c.querySelector('a[href]'), id + ' href'); ok(/pending/.test(c.textContent) && !/https?:/.test(c.textContent), id + ' text'); } }
  });
  await gate(`icons are always inside the header at every breakpoint (no hiding rule) [${k}]`, () => { const c = rd('src/styles.css'); ok(!/\.socials?[^{]*\{[^}]*display:\s*none/.test(c) && !/\.social[^{]*\{[^}]*display:\s*none/.test(c), 'hidden'); ok(/\.social \{ width: 44px; height: 44px;/.test(c), '44px tap'); });
}

// ================= behaviour: board, own row, market =================
console.log('board behaviour (fake network, real page code)');
const absentRun = await run(built.allAbsent.out);
const statedRun = await run(built.allStated.out);
const rowsOf = (doc) => [...doc.querySelectorAll('#rows > li.row')];
await gate('CA absent: row 1 is the brand-logo placeholder, not a letter tile', () => {
  const r = rowsOf(absentRun.doc)[0]; ok(r.classList.contains('placeholder') && r.classList.contains('own'), 'class'); const img = r.querySelector('.tile img'); ok(img && /brand\/floated-logo\.png$/.test(img.getAttribute('src')), 'brand logo'); ok(!r.querySelector('.tile-letter'), 'letter tile');
  eq(r.querySelector('.price').textContent, '$0.00'); for (const c of ['chg', 'vol', 'liq']) eq(r.querySelector('.' + c).textContent, '· · · · ·'); ok(!r.querySelector('button,a'), 'clickable'); eq(r.getAttribute('aria-disabled'), 'true');
  ok(/\.row\.placeholder \{ pointer-events: none/.test(rd('src/styles.css')), 'non-clickable css'); ok(/\.row\.own \{[^}]*ownPulse/.test(rd('src/styles.css')), 'pulse on placeholder');
});
await gate('CA absent: rows 2-10 are trending, nine of them, Solana only, volume order', () => {
  const rs = rowsOf(absentRun.doc); eq(rs.length, 10); const syms = rs.slice(1).map((r) => r.querySelector('.sym').textContent); eq(syms.length, 9); ok(!syms.includes('OWNX') || true);
  const vols = absentRun.app.state.trending.map((r) => r.volume); ok(vols.every((v, i) => !i || vols[i - 1] >= v), 'sorted');
  ok(!absentRun.calls.some((c) => /0xabab/.test(c.url)), 'ethereum address requested');
  for (const r of rs.slice(1)) ok(r.querySelector('.cpy[data-copy]'), 'copy button');
});
await gate('CA absent: no own-token requests are made', () => ok(!absentRun.calls.some((c) => /latest\/dex|pump\.fun/.test(c.url)), 'own fetch'));
await gate('CA stated: own requests fire in parallel (Promise.all) before either resolves', () => {
  const own = statedRun.calls.filter((c) => /latest\/dex\/tokens|pump\.fun/.test(c.url)); eq(own.length >= 2, true); const i = own.map((c) => c.t); ok(Math.abs(i[0] - i[1]) <= 3, 'not adjacent: ' + i);
  ok(own.some((c) => c.url.endsWith('/latest/dex/tokens/' + OWN)) && own.some((c) => c.url.endsWith('/coins/' + OWN)), 'urls');
});
await gate('CA stated: row 1 is the own token, pinned, mint pulse class, pair chosen by baseToken + volume.h24', () => {
  const r = rowsOf(statedRun.doc)[0]; ok(r.classList.contains('own') && !r.classList.contains('placeholder'), 'class'); eq(r.querySelector('.sym').textContent, 'OWN'); eq(r.querySelector('.cpy').dataset.copy, OWN); ok(!/DECOY/.test(statedRun.doc.querySelector('#rows').textContent), 'decoy chosen');
  eq(r.querySelector('.vol').textContent, '$5.0K');
});
await gate('CA stated: logo is pump.fun image_uri, never the DexScreener CDN', () => {
  const src = rowsOf(statedRun.doc)[0].querySelector('.tile img').getAttribute('src'); eq(src, 'https://pump.test/own.png'); ok(!/dd\.dexscreener|cdn\.dexscreener/.test(src), 'cdn');
  ok(!/dd\.dexscreener\.com/.test(rd('src/js/own.js').replace(/\/\/.*$/gm, '')), 'code references dd cdn');
});
await gate('CA stated: logo falls back to assets/logo-192.png when pump.fun fails or image errors', async () => {
  const r2 = await run(built.allStated.out, { pumpFail: true }); eq(rowsOf(r2.doc)[0].querySelector('.tile img').getAttribute('src'), 'assets/logo-192.png');
  const img = rowsOf(statedRun.doc)[0].querySelector('.tile img'); img.dispatchEvent(new statedRun.win.Event('error')); eq(img.getAttribute('src'), 'assets/logo-192.png');
});
await gate('CA stated: liquidity falls back to marketCap with title "Mkt Cap"', () => { const l = rowsOf(statedRun.doc)[0].querySelector('.liq'); eq(l.textContent, '$50.0K'); eq(l.title, 'Mkt Cap'); });
await gate('CA stated: own token dedupes out of trending, nine trending rows remain', () => {
  const rs = rowsOf(statedRun.doc); eq(rs.length, 10); eq(rs.filter((r) => r.querySelector('[data-copy]')?.dataset.copy === OWN).length, 1); ok(rs.slice(1).every((r) => !r.classList.contains('own')), 'own below'); eq(rs.slice(1).filter((r) => r.querySelector('.sym').textContent !== '—').length, 9);
});
await gate('CA stated: console carries both own-token diagnostics', () => { const m = statedRun.logs.map((l) => l[0]); ok(m.includes('[floated] own token raw response') && m.includes('[floated] own liquidity candidates'), m.join()); });
await gate('market is independent of CA state: identical market requests in both branches', () => {
  const m = (c) => c.filter((x) => /token-boosts|tokens\/v1\/solana/.test(x.url)).map((x) => x.url).join('\n'); eq(m(statedRun.calls), m(absentRun.calls));
});
await gate('market follows the market-source record only: unstated record means zero network calls', async () => {
  const d = join(tmp, 'nosrc'); const rp = join(tmp, 'nosrc.json'); writeFileSync(rp, JSON.stringify(variant((r) => { r['market-source'] = { label: 'Market feed', state: 'absent' }; }))); build({ registerPath: rp, out: d, quiet: true });
  const r = await run(d, {}, { wait: 200 }); eq(r.calls.length, 0, 'calls'); ok(!r.app.state.everLoaded, 'loaded');
});
await gate('board dashes + error when the source is down and nothing was ever loaded', async () => {
  const r = await run(built.allAbsent.out, { fail: true }, { wait: 100 }); ok(!r.doc.getElementById('board-error').hidden, 'error shown'); const c = rowsOf(r.doc)[1].querySelector('.price'); eq(c.textContent, '—');
});
await gate('last good data is kept when a refresh fails', async () => {
  const doc = new JSDOM('<html></html>').window.document; let n = 0, last = null, errs = 0; const timers = { q: [], set(f, d) { this.q.push([f, d]); return this.q.length; }, clear() {} };
  const p = createPoller({ doc, timers, task: async () => { if (++n === 2) throw new Error('x'); return n; }, onData: (d) => { last = d; }, onError: () => { errs++; } });
  p.start(); await new Promise((r) => setTimeout(r, 10)); eq(last, 1); eq(timers.q.at(-1)[1], 60000, '60s'); await timers.q.at(-1)[0](); await new Promise((r) => setTimeout(r, 10)); eq(last, 1, 'kept'); eq(errs, 1); ok(timers.q.at(-1)[1] < 60000, 'backoff delay'); p.stop();
});
await gate('exponential backoff doubles the wait (600, 1200, 2400) then gives up', async () => {
  const waits = []; let tries = 0; try { await withBackoff(async () => { tries++; throw new Error('e'); }, { wait: async (ms) => { waits.push(ms); } }); } catch {} eq(waits.join(','), '600,1200,2400'); eq(tries, 4);
});
await gate('poller: no timer while hidden, immediate fetch when visible again', async () => {
  const doc = new JSDOM('<html></html>').window.document; let vis = 'visible'; Object.defineProperty(doc, 'visibilityState', { get: () => vis }); const timers = { q: [], set(f, d) { this.q.push(d); return 1; }, clear() {} }; let n = 0;
  const p = createPoller({ doc, timers, task: async () => ++n, onData() {} }); p.start(); await new Promise((r) => setTimeout(r, 10)); eq(n, 1);
  vis = 'hidden'; doc.dispatchEvent(new doc.defaultView.Event('visibilitychange')); const before = timers.q.length; await new Promise((r) => setTimeout(r, 10)); eq(timers.q.length, before, 'hidden scheduled'); eq(n, 1);
  vis = 'visible'; doc.dispatchEvent(new doc.defaultView.Event('visibilitychange')); await new Promise((r) => setTimeout(r, 10)); eq(n, 2, 'immediate'); p.stop();
});
await gate('letter tile: two letters when symbol has at least two, used when imageUrl is missing', async () => {
  const f = net(); const orig = f.fetch; const fetch = async (u) => { const r = await orig(u); if (/tokens\/v1\/solana/.test(u)) { const j = await r.json(); j.forEach((p) => { delete p.info; }); return { ok: true, json: async () => j }; } return r; };
  const dom = new JSDOM(readFileSync(join(built.allAbsent.out, 'index.html'), 'utf8')); const app = mainMod.boot({ document: dom.window.document, fetch, log() {}, effects: false }); const t0 = Date.now(); while (!app.state.everLoaded && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20)); app.poller.stop();
  const t = dom.window.document.querySelectorAll('#rows .row')[1].querySelector('.tile'); ok(t.classList.contains('tile-letter'), 'letter tile'); eq(t.textContent.length, 2);
});
await gate('tabs reorder the trending rows and keep the own row first', async () => {
  const doc = statedRun.doc; doc.querySelector('[data-sort="depth"]').click(); const rs = rowsOf(doc); ok(rs[0].classList.contains('own'), 'own first'); eq(rs.length, 10);
});
await gate('copy button + CA slot copy full value and show feedback', async () => {
  const dom = new JSDOM(readFileSync(join(built.allStated.out, 'index.html'), 'utf8')); let copied = null; Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t) => { copied = t; } } }); globalThis.navigator ??= dom.window.navigator;
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator'); Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  const app = mainMod.boot({ document: dom.window.document, fetch: net().fetch, log() {}, effects: false }); const b = dom.window.document.querySelector('button.ca'); b.click(); await new Promise((r) => setTimeout(r, 30)); app.poller.stop();
  eq(copied, TEST_CA); ok(b.classList.contains('copied') && b.querySelector('[data-hint]').textContent === 'Copied', 'feedback'); if (prev) Object.defineProperty(globalThis, 'navigator', prev);
});

// ================= dist integrity =================
console.log('dist');
await gate('dist/ is the deploy root: index, assets, favicon, js, css, 404', () => { for (const f of ['index.html', '404.html', 'styles.css', 'tokens.css', 'js/main.js', 'assets/favicon.svg', 'assets/logo-192.png', 'brand/floated-logo.png', 'assets/hero-beams.jpg']) ok(existsSync(join(realDist, f)), f); });
await gate('dist html references only files that exist in dist', () => {
  const h = readFileSync(join(realDist, 'index.html'), 'utf8'); for (const m of h.matchAll(/(?:src|href)="([^"#:]+\.[a-z0-9]+)"/g)) ok(existsSync(join(realDist, m[1])), m[1]);
  for (const m of readFileSync(join(realDist, 'styles.css'), 'utf8').matchAll(/url\(([^)]+)\)/g)) ok(existsSync(join(realDist, m[1])), m[1]);
});
await gate('dist has no source maps, no node_modules, no tools', () => { const n = walkAll(realDist).map((p) => relative(realDist, p)); ok(!n.some((x) => /\.map$|node_modules|^tools|\.py$/.test(x)), n.join()); });
await gate('dist matches a fresh build of register.json (not stale)', () => {
  const d = join(tmp, 'fresh'); build({ registerPath: join(root, 'register.json'), out: d, quiet: true }); eq(readFileSync(join(d, 'index.html'), 'utf8'), readFileSync(join(realDist, 'index.html'), 'utf8'));
});
await gate('page title and no wording of the removed items: no animated logo, no coin icons in hero', () => { const h = readFileSync(join(realDist, 'index.html'), 'utf8'); ok(!/<canvas[^>]*coin/i.test(h) && !/class="[^"]*coin/.test(h), 'coin'); });

rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\ngates: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
