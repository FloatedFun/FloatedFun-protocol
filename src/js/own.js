// Own token row data. Active only when the ca register record is stated.
import { getJson, pickPair, toRow } from './market.js';

export const FALLBACK_LOGO = 'assets/logo-192.png';


export async function loadOwn(fetchFn, src, ca, log = console.log) {
  const safe = (url) => getJson(fetchFn, url).catch((e) => ({ __error: String(e && e.message || e) }));
  const [dex, pump] = await Promise.all([
    safe(src.own.replace('{ca}', ca)),
    src.ownLogo ? safe(src.ownLogo.replace('{ca}', ca)) : Promise.resolve(null),
  ]);
  log('[floated] own token raw response', { dex, pump });

  const pair = pickPair((dex && dex.pairs) || [], ca);
  const usd = Number(pair && pair.liquidity && pair.liquidity.usd) || 0;
  const mcap = Number(pair && (pair.marketCap || pair.fdv)) || 0;
  log('[floated] own liquidity candidates', { liquidityUsd: usd, marketCap: pair && pair.marketCap, fdv: pair && pair.fdv });

  const base = pair ? toRow(pair) : { address: ca, symbol: '', name: '', price: null, change: null, volume: null, liquidity: null, url: null };
  base.address = ca;
  if (usd > 0) { base.liquidity = usd; base.liquidityLabel = 'Liquidity'; }
  else if (mcap > 0) { base.liquidity = mcap; base.liquidityLabel = 'Mkt Cap'; }
  else { base.liquidity = null; base.liquidityLabel = 'Liquidity'; }
  // Never the DexScreener CDN logo: pump.fun image first, packaged logo otherwise.
  base.logo = (pump && !pump.__error && pump.image_uri) || null;
  base.own = true;
  return base;
}
