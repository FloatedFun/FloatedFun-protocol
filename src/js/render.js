// Markup for register-driven slots. Used by the build and by tests; the page only attaches behaviour.
import { isStated, handleOf } from './register.js';

export const ICON_X = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
export const ICON_GH = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function socialHtml(id, rec, icon) {
  const label = rec.label;
  if (isStated(rec)) {
    const h = handleOf(rec.url);
    return `<a class="social" data-record="${id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label + (h ? ' ' + h : ''))}">${icon}</a>`;
  }
  return `<span class="social inert" data-record="${id}" data-state="${esc(rec.state)}" role="img" aria-disabled="true" aria-label="${esc(label)} pending">${icon}</span>`;
}

export function socialsHtml(reg) {
  const r = reg.records;
  return socialHtml('x', r.x, ICON_X) + socialHtml('github', r.github, ICON_GH);
}

export function caHtml(reg) {
  const r = reg.records.ca;
  if (isStated(r)) {
    return `<button type="button" class="ca" data-record="ca" data-state="stated" data-copy="${esc(r.value)}" aria-label="Copy contract address"><span class="ca-label">${esc(r.label)}</span><span class="ca-value">${esc(r.value)}</span><span class="ca-hint" data-hint>Tap to copy</span></button>`;
  }
  return `<div class="ca inert" data-record="ca" data-state="${esc(r.state)}"><span class="ca-label">${esc(r.label)}</span><span class="ca-value ca-pending">pending</span></div>`;
}

export function recordCardsHtml(reg) {
  const r = reg.records;
  const chip = (st) => `<span class="chip ${st === 'stated' ? 'chip-on' : 'chip-off'}">${st === 'stated' ? 'stated' : 'pending'}</span>`;
  const card = (id, body) => `<article class="card spot reveal" data-record-card="${id}" data-state="${r[id].state}"><div class="card-top"><h3>${esc(r[id].label)}</h3>${chip(r[id].state)}</div>${body}</article>`;
  const dim = '<p class="big dim">pending</p>';
  const out = [];
  out.push(card('chain', isStated(r.chain) ? `<p class="big">${esc(r.chain.value)}</p><p class="muted">${esc(r.chain.source)} · ${esc(r.chain.scope)}</p>` : dim));
  out.push(card('ca', isStated(r.ca) ? `<p class="mono wrapany">${esc(r.ca.value)}</p>` : dim));
  for (const id of ['x', 'github']) out.push(card(id, isStated(r[id]) ? `<p class="big">${esc(handleOf(r[id].url))}</p>` : dim));
  const m = r['market-source'];
  out.push(card('market-source', isStated(m) ? `<p class="big">${esc(m.value)}</p><p class="muted">${esc(m.source)} · ${esc(m.scope)}</p>` : dim));
  return out.join('\n');
}
