const fetch = require("node-fetch");
const { getIdentityToken } = require("./prices");

// Same stream-service instance getLiveStreamPrices() (in prices.js) calls
// for live ticks — see that file's comment for why it's europe-west1 and
// not the default region. Reused here rather than duplicated so both
// proxies always point at the same deployment.
const STREAM_SERVICE_URL =
  process.env.STREAM_SERVICE_URL !== undefined
    ? process.env.STREAM_SERVICE_URL
    : "https://etrade-binance-stream-514319786782.europe-west1.run.app";
const KLINES_FETCH_TIMEOUT_MS = 6000;

/**
 * Fetch historical candles for a symbol via stream-service's /klines
 * route (which itself calls Binance from europe-west1). Never throws —
 * returns [] on any failure (service down, symbol unsupported, Binance
 * itself erroring) so the API layer can just report "unavailable"
 * instead of a 500.
 * @param {string} symbol - e.g. "BTC"
 * @param {string} interval - "1h" | "4h" | "1d" | "1w"
 * @param {number} limit
 * @returns {Promise<Array<{time:number,open:number,high:number,low:number,close:number,volume:number}>>}
 */
async function getKlines(symbol, interval, limit) {
  if (!STREAM_SERVICE_URL) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KLINES_FETCH_TIMEOUT_MS);

  try {
    const token = await getIdentityToken(STREAM_SERVICE_URL);
    const url =
      `${STREAM_SERVICE_URL}/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`stream-service /klines failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "klines error");
    return data.candles || [];
  } catch (err) {
    console.error(`Failed to fetch ${symbol} klines via stream-service:`, err.message || err);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { getKlines };
