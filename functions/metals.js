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

/**
 * Fetch current USD prices for a list of metal ticker symbols.
 * gold-api.com only exposes a per-symbol endpoint (no batch call like
 * CoinGecko's), so this fires one request per unique symbol in parallel.
 * @param {string[]} symbols - e.g. ["GOLD", "SILVER"]
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getMetalPrices(symbols) {
  const uniqueSymbols = [
    ...new Set(symbols.map((s) => s.toUpperCase())),
  ].filter((s) => METAL_SYMBOL_TO_ID[s]);

  if (uniqueSymbols.length === 0) return {};

  const result = {};

  await Promise.all(
    uniqueSymbols.map(async (symbol) => {
      const assetSymbol = METAL_SYMBOL_TO_ID[symbol];
      try {
        const res = await fetch(`${METALS_API_BASE}/price/${assetSymbol}`);
        if (!res.ok) {
          throw new Error(`gold-api.com request failed: ${res.status}`);
        }
        const data = await res.json();
        if (typeof data.price === "number") {
          result[symbol] = data.price;
        }
      } catch (err) {
        console.error(`Failed to fetch metal price for ${symbol}:`, err);
      }
    })
  );

  return result;
}

function isSupportedMetal(symbol) {
  return Boolean(METAL_SYMBOL_TO_ID[symbol.toUpperCase()]);
}

module.exports = { getMetalPrices, isSupportedMetal, METAL_SYMBOL_TO_ID };
