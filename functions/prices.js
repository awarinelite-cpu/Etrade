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
};

/**
 * Fetch current USD prices for a list of ticker symbols in one call.
 * @param {string[]} symbols - e.g. ["BTC", "ETH"]
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getPrices(symbols) {
  const uniqueIds = [
    ...new Set(symbols.map((s) => SYMBOL_TO_ID[s]).filter(Boolean)),
  ];
  if (uniqueIds.length === 0) return {};

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds.join(
    ","
  )}&vs_currencies=usd`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status}`);
  }
  const data = await res.json();

  // Map back from coingecko id -> our ticker symbol
  const idToSymbol = Object.fromEntries(
    Object.entries(SYMBOL_TO_ID).map(([sym, id]) => [id, sym])
  );

  const result = {};
  for (const [id, val] of Object.entries(data)) {
    const symbol = idToSymbol[id];
    if (symbol) result[symbol] = val.usd;
  }
  return result;
}

function isSupportedSymbol(symbol) {
  return Boolean(SYMBOL_TO_ID[symbol.toUpperCase()]);
}

module.exports = { getPrices, isSupportedSymbol, SYMBOL_TO_ID };
