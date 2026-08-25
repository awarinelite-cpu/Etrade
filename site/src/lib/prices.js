// Mirrors functions/prices.js and functions/metals.js. Kept in sync with
// those two lists — the bot and the dashboard should always support the
// same set of symbols. Both source APIs are free, keyless, and CORS-open.

export const SYMBOL_TO_ID = {
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

export const METAL_SYMBOL_TO_ID = {
  GOLD: "XAU",
  SILVER: "XAG",
  PALLADIUM: "XPD",
};

export const ALL_SYMBOLS = [
  ...Object.keys(SYMBOL_TO_ID),
  ...Object.keys(METAL_SYMBOL_TO_ID),
];

export function isSupportedSymbol(symbol) {
  return Boolean(SYMBOL_TO_ID[symbol?.toUpperCase()]);
}

export function isSupportedMetal(symbol) {
  return Boolean(METAL_SYMBOL_TO_ID[symbol?.toUpperCase()]);
}

export function isSupportedAsset(symbol) {
  return isSupportedSymbol(symbol) || isSupportedMetal(symbol);
}

async function fetchCoinPrices(symbols) {
  if (symbols.length === 0) return {};
  const ids = symbols.map((s) => SYMBOL_TO_ID[s]).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
  );
  if (!res.ok) throw new Error(`CoinGecko request failed: ${res.status}`);
  const data = await res.json();
  const result = {};
  for (const symbol of symbols) {
    const id = SYMBOL_TO_ID[symbol];
    if (data[id]?.usd !== undefined) result[symbol] = data[id].usd;
  }
  return result;
}

async function fetchMetalPrices(symbols) {
  if (symbols.length === 0) return {};
  const result = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const assetSymbol = METAL_SYMBOL_TO_ID[symbol];
      try {
        const res = await fetch(`https://api.gold-api.com/price/${assetSymbol}`);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.price === "number") result[symbol] = data.price;
      } catch {
        // best-effort — one metal failing shouldn't break the others
      }
    })
  );
  return result;
}

/**
 * Fetch current USD prices for a mixed list of symbols (coins + metals).
 * @param {string[]} symbols
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
export async function getAssetPrices(symbols) {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const coinSymbols = unique.filter(isSupportedSymbol);
  const metalSymbols = unique.filter(isSupportedMetal);

  const [coinPrices, metalPrices] = await Promise.all([
    fetchCoinPrices(coinSymbols),
    fetchMetalPrices(metalSymbols),
  ]);

  return { ...coinPrices, ...metalPrices };
}
