const { getPrices, isSupportedSymbol, SYMBOL_TO_ID } = require("./prices");
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

module.exports = {
  ALL_SUPPORTED_SYMBOLS,
  isSupportedAsset,
  isSupportedSymbol,
  isSupportedMetal,
  getAssetPrices,
};
