// Build: src/ + register.json -> dist/. Overrides for tests: REGISTER_PATH, OUT_DIR.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, publicView, isStated, fmtUsd } from '../src/js/register.js';
import { socialsHtml, caHtml, recordCardsHtml, esc } from '../src/js/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function build({ registerPath = process.env.REGISTER_PATH || join(root, 'register.json'), out = process.env.OUT_DIR || join(root, 'dist'), quiet = false } = {}) {
  const reg = JSON.parse(readFileSync(registerPath, 'utf8'));
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));
  const pub = publicView(reg);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const d of ['js', 'assets', 'brand']) cpSync(join(root, 'src', d), join(out, d), { recursive: true });
  for (const f of ['styles.css', 'tokens.css']) cpSync(join(root, 'src', f), join(out, f));

  const tokens = readFileSync(join(root, 'src/tokens.css'), 'utf8');
  const theme = (tokens.match(/--c-deep:\s*(#[0-9a-fA-F]{6})/) || [])[1];
  const ca = pub.records.ca;
  const stat = {
    chain: isStated(pub.records.chain) ? esc(pub.records.chain.value) : 'pending',
    ca: isStated(ca) ? `<span class="wrapany">${esc(ca.value)}</span>` : 'pending',
  };
  let html = readFileSync(join(root, 'src/index.html'), 'utf8')
    .replace('{{THEME}}', theme)
    .replace('{{SOCIALS}}', socialsHtml(pub))
    .replace('{{CA}}', caHtml(pub))
    .replace('{{STAT_CHAIN}}', stat.chain)
    .replace('{{STAT_CA}}', stat.ca)
    .replace('{{RECORDS}}', recordCardsHtml(pub))
    .replace('{{REGISTER}}', JSON.stringify(pub).replace(/</g, '\\u003c'));
  if (isStated(ca)) html = html.replace('class="v mono-s"', 'class="v mono-s on"');
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unresolved template slot');
  writeFileSync(join(out, 'index.html'), html);
  writeFileSync(join(out, '404.html'), html.replace('<title>FLOATED</title>', '<title>FLOATED</title>'));
  if (!quiet) console.log(`[build] ${out} ca=${ca.state} x=${pub.records.x.state} github=${pub.records.github.state}`);
  return { out, reg: pub };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { build(); } catch (e) { console.error(e.message); process.exit(1); }
}
void existsSync; void fmtUsd;
