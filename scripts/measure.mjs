// Measures dist/ in a real browser at five widths, for the real register and a CA-stated variant.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { build } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SIZES = [[360, 800], [390, 844], [430, 932], [1366, 768], [1440, 900]];
const shots = process.env.SHOTS_DIR; if (shots) mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'floated-measure-'));
const reg = JSON.parse(readFileSync(join(root, 'register.json'), 'utf8'));
reg.records.ca = { label: 'Contract', state: 'stated', value: 'So11111111111111111111111111111111111111112' };
reg.records.x = { label: 'X', state: 'stated', url: 'https://x.com/floatedtest' };
writeFileSync(join(tmp, 'stated.json'), JSON.stringify(reg));
build({ registerPath: join(tmp, 'stated.json'), out: join(tmp, 'dist-stated'), quiet: true });
const targets = [['real', join(root, 'dist')], ['ca-stated', join(tmp, 'dist-stated')]];

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
let bad = 0;
for (const [label, dir] of targets) {
  const s = await serve(dir);
  for (const [w, h] of SIZES) {
    const p = await browser.newPage(); await p.setViewport({ width: w, height: h });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`http://127.0.0.1:${s.port}/`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 7000));
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); } scrollTo(0, 0); });
    await new Promise((r) => setTimeout(r, 1500));
    const m = await p.evaluate(() => {
      const box = (e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      const small = [...document.querySelectorAll('a[href], button, .social, .ca, [role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.width < 43.5 || r.height < 43.5) && !e.closest('[hidden]'); }).map((e) => (e.className || e.tagName) + ' ' + JSON.stringify(box(e)));
      const soc = [...document.querySelectorAll('.socials .social')].map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.record, state: e.dataset.state, x: Math.round(r.left), right: Math.round(innerWidth - r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vis: r.width > 0 && getComputedStyle(e).visibility !== 'hidden' }; });
      const ca = document.querySelector('.ca'); const cv = ca.querySelector('.ca-value');
      const r = cv.getBoundingClientRect(); const rows = [...document.querySelectorAll('#rows .row')];
      return {
        overflowX: document.documentElement.scrollWidth - innerWidth,
        small, soc,
        ca: { fontPx: parseFloat(getComputedStyle(cv).fontSize), text: cv.textContent.length, inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, h: Math.round(ca.getBoundingClientRect().height) },
        h1px: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
        rows: rows.length, rowH: rows[1] ? Math.round(rows[1].getBoundingClientRect().height) : 0,
        loaded: rows.filter((x) => !x.classList.contains('is-skel')).length,
        row1: rows[0].className.replace(/\s+/g, '.'), ticker: document.querySelectorAll('#ticker-track .tk-set').length,
        rowOverflow: rows.some((x) => x.scrollWidth > x.clientWidth + 1),
        status: document.getElementById('status-text').textContent,
      };
    });
    const fails = [];
    if (m.overflowX > 0) fails.push('horizontal overflow ' + m.overflowX);
    if (m.small.length) fails.push('tap targets <44: ' + m.small.join('; '));
    if (m.soc.length !== 2 || m.soc.some((x) => !x.vis || x.w < 44 || x.h < 44)) fails.push('socials ' + JSON.stringify(m.soc));
    if (!m.ca.inView) fails.push('CA not fully in view');
    if (m.rowOverflow) fails.push('row overflow');
    if (m.loaded < 10) fails.push('board not loaded: ' + m.loaded);
    if (errs.length) fails.push('page errors ' + errs.join('|'));
    if (label === 'ca-stated' && m.ca.text !== 44 && m.ca.text < 32) fails.push('CA text length ' + m.ca.text);
    console.log(`[${label}] ${w}x${h} overflowX=${m.overflowX} ca=${m.ca.fontPx}px/${m.ca.h}h/${m.ca.text}c h1=${m.h1px}px rows=${m.rows}/loaded ${m.loaded} rowH=${m.rowH} ticker=${m.ticker} row1=${m.row1} socials=[${m.soc.map((x) => `${x.id}:${x.state}@${x.right}r,${x.top}t ${x.w}x${x.h}`).join(' ')}] status=${m.status} ${fails.length ? 'FAIL ' + fails.join(' / ') : 'ok'}`);
    if (fails.length) bad++;
    if (shots) await p.screenshot({ path: join(shots, `${label}-${w}.png`) });
    await p.close();
  }
  s.close();
}
await browser.close();
console.log(bad ? `measure: ${bad} breakpoint failures` : 'measure: all breakpoints pass');
process.exit(bad ? 1 : 0);
