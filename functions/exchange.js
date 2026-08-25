const ccxt = require("ccxt");

// Set with:
//   firebase functions:secrets:set BINANCE_API_KEY
//   firebase functions:secrets:set BINANCE_API_SECRET
// These are TESTNET keys for now (from testnet.binance.vision) — fake
// funds, real market behavior. Swapping to live keys later is a matter
// of setting these secrets to real Binance keys and flipping
// USE_TESTNET to false — nothing else in this file needs to change.
const USE_TESTNET = true;

function getExchange() {
  const exchange = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_API_SECRET,
    enableRateLimit: true,
  });

  if (USE_TESTNET) {
    exchange.setSandboxMode(true);
  }

  return exchange;
}

/** Fetch account balances (non-zero only). */
async function getBalance() {
  const exchange = getExchange();
  const balance = await exchange.fetchBalance();
  const nonZero = {};
  for (const [asset, amount] of Object.entries(balance.total || {})) {
    if (amount > 0) nonZero[asset] = amount;
  }
  return nonZero;
}

/**
 * Place a market order.
 * @param {string} symbol - e.g. "BTC/USDT"
 * @param {"buy"|"sell"} side
 * @param {number} amount - quantity of the base asset (e.g. 0.001 BTC)
 */
async function placeMarketOrder(symbol, side, amount) {
  const exchange = getExchange();
  const order = await exchange.createOrder(symbol, "market", side, amount);
  return order;
}

/** Fetch the current market price for a symbol, e.g. "BTC/USDT". */
async function getMarketPrice(symbol) {
  const exchange = getExchange();
  const ticker = await exchange.fetchTicker(symbol);
  return ticker.last;
}

module.exports = { getExchange, getBalance, placeMarketOrder, getMarketPrice, USE_TESTNET };
