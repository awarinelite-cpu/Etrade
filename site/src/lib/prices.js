// Mirrors functions/prices.js and functions/metals.js. Kept in sync with
// those two lists — the bot and the dashboard should always support the
// same set of symbols.
//
// Prices themselves come from getLivePricesApi (functions/index.js), not
// straight from CoinGecko/gold-api — that endpoint proxies to the exact
// same getAssetPrices() the bot uses, which checks stream-service's live
// Binance feed first. That's what makes the dashboard tick against the
// same real-time number alerts fire on, instead of a separately-cached,
// slower browser-side fetch.
const FUNCTIONS_BASE = "https://us-central1-e-trading-f5bec.cloudfunctions.net";

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

export const COIN_SYMBOLS = Object.keys(SYMBOL_TO_ID);
export const METAL_SYMBOLS = Object.keys(METAL_SYMBOL_TO_ID);

export const ALL_SYMBOLS = [...COIN_SYMBOLS, ...METAL_SYMBOLS];

export function isSupportedSymbol(symbol) {
  return Boolean(SYMBOL_TO_ID[symbol?.toUpperCase()]);
}

export function isSupportedMetal(symbol) {
  return Boolean(METAL_SYMBOL_TO_ID[symbol?.toUpperCase()]);
}

export function isSupportedAsset(symbol) {
  return isSupportedSymbol(symbol) || isSupportedMetal(symbol);
}

/**
 * Fetch current USD prices for a mixed list of symbols (coins + metals)
 * via getLivePricesApi. Coins come back stream-service-live when
 * available (same number alerts fire against); metals come from
 * gold-api.com. Falls back to an empty result on failure so a blip
 * doesn't crash the poll loop — the UI just keeps the last-known price.
 * @param {string[]} symbols
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
export async function getAssetPrices(symbols) {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))].filter(
    isSupportedAsset
  );
  if (unique.length === 0) return {};

  try {
    const res = await fetch(
      `${FUNCTIONS_BASE}/getLivePricesApi?symbols=${unique.join(",")}`
    );
    if (!res.ok) throw new Error(`getLivePricesApi failed: ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "getLivePricesApi error");
    return data.prices || {};
  } catch (err) {
    console.error("Failed to fetch live prices:", err);
    return {};
  }
}
