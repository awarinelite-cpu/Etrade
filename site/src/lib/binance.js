// Historical OHLC candles for the coin detail page. Separate from
// lib/prices.js (which only ever gives a current spot price via our own
// getLivePricesApi) — candlesticks need real history, and Binance's
// public klines endpoint is free, keyless, and CORS-enabled for direct
// browser calls, so there's no need to route this through our backend.
//
// Mirrors stream-service/index.js's SYMBOL_TO_BINANCE (kept separate on
// purpose: that one lists lowercase ws-stream pairs, this needs the
// uppercase REST pair). MATIC trades as POLUSDT since Binance's Sept 2024
// migration — bot-facing ticker stays "MATIC" so existing alerts don't
// break.
export const SYMBOL_TO_BINANCE_PAIR = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  ADA: "ADAUSDT",
  MATIC: "POLUSDT",
  DOT: "DOTUSDT",
  LINK: "LINKUSDT",
  LTC: "LTCUSDT",
  AVAX: "AVAXUSDT",
  TRX: "TRXUSDT",
  SHIB: "SHIBUSDT",
};

export function hasCandles(symbol) {
  return Boolean(SYMBOL_TO_BINANCE_PAIR[symbol?.toUpperCase()]);
}

/**
 * Fetch recent candles for a coin.
 * @param {string} symbol - our ticker, e.g. "BTC"
 * @param {string} interval - Binance interval string: 1h, 4h, 1d, 1w
 * @param {number} limit - number of candles (Binance max is 1000)
 * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>>}
 *   Empty array on any failure (unsupported symbol, network error, geo
 *   block, etc.) — callers show an "unavailable" state rather than crash.
 */
export async function fetchKlines(symbol, interval = "1d", limit = 180) {
  const pair = SYMBOL_TO_BINANCE_PAIR[symbol?.toUpperCase()];
  if (!pair) return [];

  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
    );
    if (!res.ok) {
      throw new Error(`Binance klines request failed: ${res.status}`);
    }
    const raw = await res.json();
    return raw.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (err) {
    console.error(`Failed to fetch ${symbol} candles:`, err.message || err);
    return [];
  }
}
