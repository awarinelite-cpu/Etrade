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

// stream-service (see /stream-service) holds a live Binance WebSocket and
// exposes its in-memory prices at GET /status. When it's reachable, /price
// uses that instead of CoinGecko — it's the exact number alerts are being
// evaluated against in real time, not a 30s-old cached lookup. Falls
// through to CoinGecko for anything the stream doesn't have (e.g. the
// service is down, or hasn't seen a trade tick for that symbol yet).
// Defaults to the deployed europe-west1 instance (see stream-service/README.md
// for why that region — Binance geo-blocks US Cloud Run IPs). Override with
// the STREAM_SERVICE_URL env var if you ever redeploy it elsewhere; if set
// to an empty string, this step is skipped entirely and CoinGecko handles
// everything, same as before the stream service existed.
const STREAM_SERVICE_URL =
  process.env.STREAM_SERVICE_URL !== undefined
    ? process.env.STREAM_SERVICE_URL
    : "https://etrade-binance-stream-514319786782.europe-west1.run.app";
const STREAM_FETCH_TIMEOUT_MS = 2500;

/**
 * Fetch an identity token for calling another Cloud Run/Functions service
 * as this function's own service account, via the GCP metadata server.
 * Only works when actually running on GCP (Cloud Functions/Cloud Run);
 * fails harmlessly in any other environment, which the caller catches.
 */
async function getIdentityToken(audience) {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?" +
      `audience=${encodeURIComponent(audience)}&format=full`,
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!res.ok) {
    throw new Error(`metadata identity token fetch failed: ${res.status}`);
  }
  return res.text();
}

/**
 * Best-effort fetch of live prices from stream-service. Never throws —
 * returns {} on any failure (service down, not configured, timed out,
 * symbol not yet streamed) so callers can just fall through to CoinGecko.
 *
 * Also treats a self-reported stale connection (data.isStale — see
 * stream-service's watchdog) the same as a failure: if the WebSocket feed
 * has gone dark, /status still responds 200 OK with whatever the last real
 * tick was, so trusting it here would mean silently serving a frozen price
 * as if it were live. Falling through to CoinGecko in that case is strictly
 * better even though CoinGecko is slower to update — a stale-but-labeled
 * price beats a stale-but-trusted one.
 */
async function getLiveStreamPrices(symbols) {
  if (!STREAM_SERVICE_URL) return {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_FETCH_TIMEOUT_MS);

  try {
    const token = await getIdentityToken(STREAM_SERVICE_URL);
    const res = await fetch(`${STREAM_SERVICE_URL}/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`stream-service /status failed: ${res.status}`);
    }
    const data = await res.json();

    if (data.isStale) {
      console.warn(
        `stream-service reports its own feed as stale (${Math.round((data.staleForMs || 0) / 1000)}s since last tick) — ` +
          "falling through to CoinGecko instead of trusting it."
      );
      return {};
    }

    const live = data.latestPrice || {};

    const result = {};
    for (const symbol of symbols) {
      if (typeof live[symbol] === "number") {
        result[symbol] = live[symbol];
      }
    }
    return result;
  } catch (err) {
    console.error("Failed to fetch live stream prices:", err.message || err);
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch current USD prices for a list of ticker symbols in one call.
 * Never throws — on failure, falls back to stale cache per-symbol and
 * simply omits symbols with no usable price (caller already treats a
 * missing symbol as "couldn't fetch"). Respects the same cache as
 * getPrices()'s CoinGecko fallback path, so calling both for the same
 * symbol within CACHE_TTL_MS costs one real HTTP request, not two.
 * @param {string[]} symbols - e.g. ["BTC", "ETH"]
 * @returns {Promise<Object>} map of symbol -> price in USD
 */
async function getCoinGeckoPrices(symbols) {
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

  const result = {};

  // Prefer live stream prices first — skip CoinGecko entirely for
  // anything it already has.
  const requestedSymbols = uniqueIds.map((id) => idToSymbol[id]);
  const livePrices = await getLiveStreamPrices(requestedSymbols);
  for (const [symbol, price] of Object.entries(livePrices)) {
    result[symbol] = price;
  }

  const remainingSymbols = requestedSymbols.filter((s) => !(s in result));
  if (remainingSymbols.length > 0) {
    Object.assign(result, await getCoinGeckoPrices(remainingSymbols));
  }

  return result;
}

function isSupportedSymbol(symbol) {
  return Boolean(SYMBOL_TO_ID[symbol.toUpperCase()]);
}

module.exports = { getPrices, getCoinGeckoPrices, isSupportedSymbol, SYMBOL_TO_ID, getIdentityToken };
