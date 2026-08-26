// Historical OHLC candles for the coin detail page.
//
// This does NOT call Binance directly from the browser (an earlier
// version did). Binance's domains are outright blocked at the ISP level
// in some countries — Nigeria's telecoms have blocked binance.com and
// related domains since the CBN/NCC crackdown in Feb 2024 — so a
// client-side fetch to api.binance.com just fails there, regardless of
// CORS or rate limits. Instead this calls our own getKlinesApi Cloud
// Function, which proxies the request through stream-service
// (europe-west1) to Binance server-side. Mirrors lib/prices.js's
// getAssetPrices, which solves the same class of problem for live
// prices.
const FUNCTIONS_BASE = "https://us-central1-e-trading-f5bec.cloudfunctions.net";

/**
 * Fetch recent candles for a coin.
 * @param {string} symbol - our ticker, e.g. "BTC"
 * @param {string} interval - "1h" | "4h" | "1d" | "1w"
 * @param {number} limit - number of candles (server caps at 500)
 * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>>}
 *   Empty array on any failure (unsupported symbol, network error,
 *   backend down, etc.) — callers show an "unavailable" state rather
 *   than crash.
 */
export async function fetchKlines(symbol, interval = "1d", limit = 180) {
  try {
    const res = await fetch(
      `${FUNCTIONS_BASE}/getKlinesApi?symbol=${encodeURIComponent(
        symbol
      )}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`getKlinesApi failed: ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "getKlinesApi error");
    return data.candles || [];
  } catch (err) {
    console.error(`Failed to fetch ${symbol} candles:`, err.message || err);
    return [];
  }
}
