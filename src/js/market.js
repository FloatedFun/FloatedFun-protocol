// Market data. Follows the market-source register record only; CA state has no effect here.
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withBackoff(fn, { retries = 3, base = 600, max = 8000, wait = sleep } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i < retries) await wait(Math.min(max, base * 2 ** i));
    }
  }
  throw last;
}

export async function getJson(fetchFn, url) {
  const r = await fetchFn(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return typeof n === 'number' && isFinite(n) ? n : null; };

export function pickPair(pairs, address) {
  return (pairs || [])
    .filter((p) => p && p.baseToken && p.baseToken.address === address)
    .sort((a, b) => (num(b.volume && b.volume.h24) || 0) - (num(a.volume && a.volume.h24) || 0))[0] || null;
}

export function toRow(pair) {
  return {
    address: pair.baseToken.address,
    symbol: pair.baseToken.symbol || '?',
    name: pair.baseToken.name || '',
    logo: (pair.info && pair.info.imageUrl) || null,
    price: num(pair.priceUsd),
    change: num(pair.priceChange && pair.priceChange.h24),
    volume: num(pair.volume && pair.volume.h24),
    liquidity: num(pair.liquidity && pair.liquidity.usd),
    liquidityLabel: 'Liquidity',
    url: pair.url || null,
  };
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// Returns up to `limit` Solana rows ranked by 24h volume.
export async function loadTrending(fetchFn, src, { limit = 10, wait = sleep } = {}) {
  if (!src || src.state !== 'stated' || !src.boosts || !src.pairs) throw new Error('market source not stated');
  const boosts = await withBackoff(() => getJson(fetchFn, src.boosts), { wait });
  const addrs = [...new Set((Array.isArray(boosts) ? boosts : []).filter((b) => b && b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('no solana entries');
  const groups = chunk(addrs.slice(0, 60), 30);
  const lists = await Promise.all(groups.map((g) => withBackoff(() => getJson(fetchFn, src.pairs.replace('{addresses}', g.join(','))), { wait })));
  const pairs = lists.flat();
  const rows = [];
  for (const a of addrs) {
    const p = pickPair(pairs, a);
    if (p) rows.push(toRow(p));
  }
  rows.sort((a, b) => (b.volume || 0) - (a.volume || 0));
  return rows.slice(0, limit);
}

// Poller: 60s cadence, pauses while hidden, fetches immediately when visible again,
// exponential backoff after failures, keeps last good data.
export function createPoller({ task, onData, onError, onState, interval = 60000, backoffBase = 4000, backoffMax = 60000, doc = globalThis.document, timers = { set: (f, d) => setTimeout(f, d), clear: (t) => clearTimeout(t) } }) {
  let timer = null, fails = 0, running = false, inflight = false, stopped = false;
  const hidden = () => !!doc && doc.visibilityState === 'hidden';
  async function tick() {
    timer = null;
    if (stopped || hidden() || inflight) return;
    inflight = true; onState && onState('loading');
    try {
      const data = await task();
      fails = 0; onData(data); onState && onState('live');
    } catch (e) {
      fails++; onError && onError(e, fails); onState && onState('retry');
    } finally { inflight = false; }
    schedule();
  }
  function schedule() {
    if (stopped || hidden()) return;
    const d = fails ? Math.min(backoffMax, backoffBase * 2 ** (fails - 1)) : interval;
    timers.clear(timer); timer = timers.set(tick, d);
  }
  function onVis() {
    if (hidden()) { timers.clear(timer); timer = null; onState && onState('paused'); } else if (running) { timers.clear(timer); tick(); }
  }
  return {
    start() { running = true; stopped = false; doc && doc.addEventListener('visibilitychange', onVis); tick(); },
    stop() { stopped = true; running = false; timers.clear(timer); doc && doc.removeEventListener('visibilitychange', onVis); },
    get fails() { return fails; },
  };
}
