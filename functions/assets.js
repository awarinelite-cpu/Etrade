const { getPrices, getCoinGeckoPrices, isSupportedSymbol, SYMBOL_TO_ID } = require("./prices");
const {
  getMetalPrices,
  isSupportedMetal,
  METAL_SYMBOL_TO_ID,
} = require("./metals");

const ALL_SUPPORTED_SYMBOLS = [
  ...Object.keys(SYMBOL_TO_ID),
  ...Object.keys(METAL_SYMBOL_TO_ID),
];

/** True if the symbol is a supported coin OR a supported metal. */
function isSupportedAsset(symbol) {
  return isSupportedSymbol(symbol) || isSupportedMetal(symbol);
}

/**
 * Fetch current USD prices for a mixed list of symbols, routing each to
 * the right source (CoinGecko for coins, gold-api.com for metals).
 * @param {string[]} symbols
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getAssetPrices(symbols) {
  const coinSymbols = symbols.filter((s) => isSupportedSymbol(s));
  const metalSymbols = symbols.filter((s) => isSupportedMetal(s));

  const [coinPrices, metalPrices] = await Promise.all([
    coinSymbols.length ? getPrices(coinSymbols) : {},
    metalSymbols.length ? getMetalPrices(metalSymbols) : {},
  ]);

  return { ...coinPrices, ...metalPrices };
}

/**
 * Fetch a second, independent price reading for cross-checking against
 * getAssetPrices()'s primary result — used to sanity-check a price alert
 * right before it fires, so one bad tick from the primary source (a
 * WebSocket glitch, a stale/corrupted read) can't trigger a false alert
 * on its own. Coins only — metals have a single source (gold-api.com),
 * so there's nothing to cross-check them against; always returns {} for
 * any metal symbols passed in.
 * @param {string[]} symbols
 * @returns {Promise<Object>} map of symbol -> price in USD (coins only)
 */
async function getSecondarySourcePrices(symbols) {
  const coinSymbols = symbols.filter((s) => isSupportedSymbol(s));
  return coinSymbols.length ? getCoinGeckoPrices(coinSymbols) : {};
}

module.exports = {
  ALL_SUPPORTED_SYMBOLS,
  isSupportedAsset,
  isSupportedSymbol,
  isSupportedMetal,
  getAssetPrices,
  getSecondarySourcePrices,
};
