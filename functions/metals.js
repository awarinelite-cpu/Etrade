const fetch = require("node-fetch");

// Map friendly ticker symbols to gold-api.com asset symbols.
// Free, no API key, no rate limit on real-time prices. See https://gold-api.com/assets
// for the full list they track if more metals need to be added later.
const METAL_SYMBOL_TO_ID = {
  GOLD: "XAU",
  SILVER: "XAG",
  PALLADIUM: "XPD",
};

const METALS_API_BASE = "https://api.gold-api.com";

// gold-api.com asks callers to cache responses for 30s. This also protects
// us from 429s when checkPrices runs every minute and /price is used on top
// of that — module-level so it persists across invocations on a warm
// instance. cache[symbol] = { price, fetchedAt }
const cache = {};
const CACHE_TTL_MS = 30 * 1000;
// If a fetch fails (e.g. 429), how long we're willing to serve a stale
// cached price rather than showing "couldn't fetch". Prices this old are
// still labeled clearly to callers via the `stale` flag if needed later.
const STALE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Fetch current USD prices for a list of metal ticker symbols.
 * gold-api.com only exposes a per-symbol endpoint (no batch call like
 * CoinGecko's), so this fires one request per unique symbol in parallel.
 * Serves cached prices within CACHE_TTL_MS, and falls back to a stale
 * cached price (up to STALE_MAX_AGE_MS old) if a live fetch fails.
 * @param {string[]} symbols - e.g. ["GOLD", "SILVER"]
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getMetalPrices(symbols) {
  const uniqueSymbols = [
    ...new Set(symbols.map((s) => s.toUpperCase())),
  ].filter((s) => METAL_SYMBOL_TO_ID[s]);

  if (uniqueSymbols.length === 0) return {};

  const result = {};
  const now = Date.now();

  await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      const cached = cache[symbol];
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        result[symbol] = cached.price;
        return;
      }

      const assetSymbol = METAL_SYMBOL_TO_ID[symbol];
      try {
        const res = await fetch(`${METALS_API_BASE}/price/${assetSymbol}`, {
          headers: {
            // Some free/no-key APIs block requests with no User-Agent,
            // or reject default node-fetch UAs from cloud-provider IPs.
            "User-Agent": "Mozilla/5.0 (compatible; E-TradingSignalAlertsBot/1.0)",
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `gold-api.com request failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
          );
        }
        const data = await res.json();
        if (typeof data.price === "number") {
          cache[symbol] = { price: data.price, fetchedAt: now };
          result[symbol] = data.price;
        } else {
          console.error(
            `gold-api.com returned unexpected shape for ${symbol}:`,
            JSON.stringify(data)
          );
        }
      } catch (err) {
        console.error(`Failed to fetch metal price for ${symbol}:`, err.message || err);
        // Fall back to a stale cached price rather than failing outright —
        // this is what keeps a transient 429 from bricking /price and alerts.
        if (cached && now - cached.fetchedAt < STALE_MAX_AGE_MS) {
          console.warn(
            `Serving stale ${symbol} price (${Math.round((now - cached.fetchedAt) / 1000)}s old) after fetch failure`
          );
          result[symbol] = cached.price;
        }
      }
    })
  );

  return result;
}

function isSupportedMetal(symbol) {
  return Boolean(METAL_SYMBOL_TO_ID[symbol.toUpperCase()]);
}

module.exports = { getMetalPrices, isSupportedMetal, METAL_SYMBOL_TO_ID };
