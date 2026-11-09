// Register helpers. Pure functions, shared by the build (node) and the page (browser).
export const STATES = ['stated', 'absent', 'unconfirmed'];
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validate(reg) {
  const errs = [];
  for (const [id, r] of Object.entries(reg.records || {})) {
    if (!STATES.includes(r.state)) errs.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) {
        if (!['label', 'state', 'recorded', 'source', 'scope'].includes(k)) errs.push(`${id}: inert record carries "${k}"`);
      }
    }
    if (id === 'ca' && r.state === 'stated' && !B58.test(r.value || '')) errs.push('ca: stated value is not a base58 address');
    if ((id === 'x' || id === 'github') && r.state === 'stated' && !/^https:\/\//.test(r.url || '')) errs.push(`${id}: stated needs https url`);
  }
  return errs;
}

// Strip fields that never reach the page (dates are data only).
export function publicView(reg) {
  const out = { records: {} };
  for (const [id, r] of Object.entries(reg.records)) {
    const { recorded, ...rest } = r;
    out.records[id] = rest;
  }
  return out;
}

export const isStated = (r) => !!r && r.state === 'stated';

// Link rule: store the URL, derive the handle.
export function handleOf(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : '';
  } catch { return ''; }
}

export const fmtUsd = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
export const fmtPrice = (n) => {
  if (n == null || !isFinite(n)) return '—';
  if (n === 0) return '$0.00';
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(Math.min(12, 3 - Math.floor(Math.log10(n))));
};
export const fmtPct = (n) => (n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
