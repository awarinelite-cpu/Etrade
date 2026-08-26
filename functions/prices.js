const fetch = require("node-fetch");

// Map friendly ticker symbols to CoinGecko coin IDs.
// Extend this as you support more coins.
const SYMBOL_TO_ID = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  MATIC: "matic-network",
  DOT: "polkadot",
  LINK: "chainlink",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  TRX: "tron",
  SHIB: "shiba-inu",
};

// CoinGecko's public (no-key) endpoint is aggressively rate-limited and
// shared across every free caller on Google Cloud's IP ranges — a single
// checkPrices run (every 1 min) plus /price commands can trip 429s even
// at low volume. Cache per-symbol and fall back to stale data on failure
// so a rate-limit blip doesn't take down the whole webhook.
const cache = {};
const CACHE_TTL_MS = 30 * 1000;
const STALE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Fetch current USD prices for a list of ticker symbols in one call.
 * Never throws — on failure, falls back to stale cache per-symbol and
 * simply omits symbols with no usable price (caller already treats a
 * missing symbol as "couldn't fetch").
 * @param {string[]} symbols - e.g. ["BTC", "ETH"]
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getPrices(symbols) {
  const uniqueIds = [
    ...new Set(symbols.map((s) => SYMBOL_TO_ID[s]).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) return {};

  const idToSymbol = Object.fromEntries(
    Object.entries(SYMBOL_TO_ID).map(([sym, id]) => [id, sym])
  );

  const now = Date.now();
  const result = {};
  const idsToFetch = [];

  for (const id of uniqueIds) {
    const symbol = idToSymbol[id];
    const cached = cache[id];
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result[symbol] = cached.price;
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length === 0) return result;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsToFetch.join(
    ","
  )}&vs_currencies=usd`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; E-TradingSignalAlertsBot/1.0)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `CoinGecko request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
      );
    }
    const data = await res.json();
    for (const [id, val] of Object.entries(data)) {
      const symbol = idToSymbol[id];
      if (symbol && typeof val.usd === "number") {
        cache[id] = { price: val.usd, fetchedAt: now };
        result[symbol] = val.usd;
      }
    }
  } catch (err) {
    console.error("Failed to fetch CoinGecko prices:", err.message || err);
    // Fall back to stale cache per-symbol rather than failing the whole batch.
    for (const id of idsToFetch) {
      const symbol = idToSymbol[id];
      const cached = cache[id];
      if (cached && now - cached.fetchedAt < STALE_MAX_AGE_MS) {
        console.warn(
          `Serving stale ${symbol} price (${Math.round((now - cached.fetchedAt) / 1000)}s old) after fetch failure`
        );
        result[symbol] = cached.price;
      }
    }
  }

  return result;
}

function isSupportedSymbol(symbol) {
  return Boolean(SYMBOL_TO_ID[symbol.toUpperCase()]);
}

module.exports = { getPrices, isSupportedSymbol, SYMBOL_TO_ID };
