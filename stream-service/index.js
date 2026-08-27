/**
 * Real-time crypto price alerting via Binance's public trade WebSocket.
 *
 * Why this exists: functions/checkPrices polls CoinGecko once a minute via
 * Cloud Scheduler, which is the fastest Cloud Scheduler supports and was
 * already tripping 429s on a free-tier endpoint. Binance's WebSocket
 * pushes every trade tick instantly and is free with no key, so this
 * service replaces polling with a persistent stream for crypto — metals
 * (gold/silver/palladium) stay on the existing scheduled function since
 * there's no free real-time feed for them.
 *
 * This must run somewhere that holds a long-lived connection (Cloud Run
 * with min-instances=1 and --no-cpu-throttling), NOT Cloud Functions —
 * Cloud Functions instances are request-scoped and get torn down between
 * invocations, which would kill the WebSocket constantly.
 *
 * Deployment note: functions/checkPrices is left untouched as a safety
 * net. Both paths write to the same Firestore "armed" flag, so if this
 * service is ever down, the 1-minute poller still covers crypto (just
 * slower) instead of alerts silently going dark. The two can't
 * meaningfully double-fire because a triggered alert flips `armed:false`
 * before the other path's next check.
 */

const express = require("express");
const WebSocket = require("ws");
const fetch = require("node-fetch");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error(
    "TELEGRAM_BOT_TOKEN is not set — alerts will be detected but no " +
      "Telegram messages will be sent. Set it as a Cloud Run secret/env var."
  );
}
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---------------------------------------------------------------------------
// Symbol mapping — keep in sync with functions/prices.js SYMBOL_TO_ID.
// Left side is our bot's ticker (what alerts are stored under in
// Firestore); right side is the Binance stream symbol (always lowercase,
// always the USDT pair). MATIC trades on Binance as POLUSDT since the
// Sept 2024 MATIC->POL migration — the mapping below keeps "MATIC" as the
// bot-facing ticker so existing alerts don't break, while subscribing to
// the correct underlying Binance stream.
// ---------------------------------------------------------------------------
const SYMBOL_TO_BINANCE = {
  BTC: "btcusdt",
  ETH: "ethusdt",
  SOL: "solusdt",
  BNB: "bnbusdt",
  XRP: "xrpusdt",
  DOGE: "dogeusdt",
  ADA: "adausdt",
  MATIC: "polusdt", // Binance delisted MATICUSDT, relisted as POLUSDT (Sep 2024)
  DOT: "dotusdt",
  LINK: "linkusdt",
  LTC: "ltcusdt",
  AVAX: "avaxusdt",
  TRX: "trxusdt",
  SHIB: "shibusdt",
};
const BINANCE_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_BINANCE).map(([sym, b]) => [b, sym])
);

// Same map, uppercase — Binance's REST klines endpoint wants e.g.
// "BTCUSDT" while the ws stream wants lowercase "btcusdt".
const SYMBOL_TO_BINANCE_REST_PAIR = Object.fromEntries(
  Object.entries(SYMBOL_TO_BINANCE).map(([sym, b]) => [sym, b.toUpperCase()])
);

// ---------------------------------------------------------------------------
// In-memory state — this is what makes it fast. No DB read on every tick.
// ---------------------------------------------------------------------------
const latestPrice = {}; // symbol -> number
let activeAlerts = []; // array of { id, ref, ...alertData }, kept fresh by a Firestore realtime listener
const lastCheckedAt = {}; // symbol -> ms timestamp, for throttling
let lastMessageAt = 0; // ms timestamp of the most recent WS message, any symbol — staleness watchdog

// Don't re-evaluate a coin's alerts more than once per this interval, even
// if Binance sends dozens of trade ticks per second. 1s matches "does it
// react within a second" while keeping Firestore/Telegram load sane.
const MIN_CHECK_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Firestore: keep activeAlerts in sync in real time (push-based, not
// polled) so a newly-created alert is picked up within moments.
// ---------------------------------------------------------------------------
function startAlertsListener() {
  db.collection("alerts")
    .where("active", "==", true)
    .onSnapshot(
      (snapshot) => {
        activeAlerts = snapshot.docs.map((doc) => ({
          id: doc.id,
          ref: doc.ref,
          ...doc.data(),
        }));
        console.log(`Alerts listener: ${activeAlerts.length} active alert(s).`);
      },
      (err) => {
        console.error("Alerts listener error:", err.message || err);
      }
    );
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------
async function sendMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    const data = await res.json();
    if (!data.ok) console.error("Telegram sendMessage failed:", data);
  } catch (err) {
    console.error("Telegram sendMessage error:", err.message || err);
  }
}

function labelTag(label) {
  if (label === "BUY") return "🟢 BUY ZONE — ";
  if (label === "SELL") return "🔴 SELL ZONE — ";
  return "";
}

async function logAlertHistory(alert, currentPrice) {
  await db.collection("alert_history").add({
    chatId: alert.chatId,
    coin: alert.coin,
    condition: alert.condition,
    targetPrice: alert.targetPrice,
    label: alert.label || null,
    repeat: Boolean(alert.repeat),
    triggeredAtPrice: currentPrice,
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Mirrors functions/index.js notifyAndDeactivate / notifyAndReArmLater —
// keep these two in sync if the alert-message wording or Firestore schema
// ever changes there.
async function notifyAndDeactivate(alert, currentPrice) {
  const labelPrefix = labelTag(alert.label);
  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!*\n\n` +
      `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
      `your target of $${alert.targetPrice.toLocaleString()}.\n\n` +
      "This alert has been deactivated. Create a new one anytime with `/alert`."
  );
  await alert.ref.update({
    active: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtPrice: currentPrice,
  });
  await logAlertHistory(alert, currentPrice);
}

async function notifyAndReArmLater(alert, currentPrice) {
  const labelPrefix = labelTag(alert.label);
  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!* 🔁\n\n` +
      `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
      `your target of $${alert.targetPrice.toLocaleString()}.\n\n` +
      "This is a repeating alert — it'll fire again next time price crosses " +
      "your target. Delete it anytime with `/delete`."
  );
  await alert.ref.update({
    armed: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtPrice: currentPrice,
  });
  await logAlertHistory(alert, currentPrice);
}

// ---------------------------------------------------------------------------
// Core check — same trigger semantics as functions/index.js checkPrices,
// but scoped to one coin and driven by a live tick instead of a poll loop.
// ---------------------------------------------------------------------------
async function checkAlertsForSymbol(symbol, currentPrice) {
  const matching = activeAlerts.filter((a) => a.coin === symbol);
  if (matching.length === 0) return;

  for (const alert of matching) {
    const conditionMet =
      (alert.condition === "above" && currentPrice >= alert.targetPrice) ||
      (alert.condition === "below" && currentPrice <= alert.targetPrice);

    if (!alert.repeat) {
      if (conditionMet) {
        notifyAndDeactivate(alert, currentPrice).catch((err) =>
          console.error("notifyAndDeactivate failed:", err)
        );
      }
      continue;
    }

    const armed = alert.armed !== false; // default true for older docs
    if (armed && conditionMet) {
      notifyAndReArmLater(alert, currentPrice).catch((err) =>
        console.error("notifyAndReArmLater failed:", err)
      );
    } else if (!armed && !conditionMet) {
      alert.ref
        .update({ armed: true })
        .catch((err) => console.error("re-arm update failed:", err));
    }
  }
}

// ---------------------------------------------------------------------------
// Binance WebSocket — combined trade stream for all supported coins.
// Auto-reconnects with backoff on drop (Binance recycles connections
// periodically, and network blips happen).
// ---------------------------------------------------------------------------
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

// How long to go without a single WS message (any symbol) before treating
// the connection as dead and forcing a reconnect. Binance's combined trade
// stream for these symbols normally ticks many times per second — 45s of
// total silence means something's actually wrong, not just a quiet moment.
//
// This exists because a WebSocket can go silently unresponsive without ever
// firing 'close' or 'error' — the TCP connection can die at the network
// layer (a NAT/load-balancer timeout, a routing blip) with no FIN/RST ever
// reaching this process. When that happens, the existing reconnect logic
// (which only runs on 'close'/'error') never triggers, latestPrice freezes
// at whatever the last real tick was, and /status keeps reporting 200 OK
// with that frozen number forever — no error anywhere in the whole chain
// from here through functions/prices.js to the dashboard and alerts. This
// watchdog is what actually detects that case instead of trusting the
// connection object's own (silent) state.
const STALE_CONNECTION_MS = 45000;
const WATCHDOG_INTERVAL_MS = 15000;

let currentWs = null;

function connectBinanceStream() {
  const streams = Object.values(SYMBOL_TO_BINANCE)
    .map((b) => `${b}@trade`)
    .join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  console.log("Connecting to Binance stream...");
  const ws = new WebSocket(url);
  currentWs = ws;

  ws.on("open", () => {
    console.log("Binance stream connected.");
    reconnectDelayMs = 1000; // reset backoff on a healthy connection
    lastMessageAt = Date.now(); // count the open itself so the watchdog doesn't fire immediately
  });

  ws.on("message", (raw) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const payload = msg.data;
    if (!payload || !payload.s || !payload.p) return;

    const binanceSymbol = payload.s.toLowerCase(); // e.g. "btcusdt"
    const symbol = BINANCE_TO_SYMBOL[binanceSymbol];
    if (!symbol) return;

    const price = parseFloat(payload.p);
    if (!Number.isFinite(price)) return;

    latestPrice[symbol] = price;

    const now = Date.now();
    if (now - (lastCheckedAt[symbol] || 0) < MIN_CHECK_INTERVAL_MS) return;
    lastCheckedAt[symbol] = now;

    checkAlertsForSymbol(symbol, price).catch((err) =>
      console.error(`checkAlertsForSymbol(${symbol}) failed:`, err)
    );
  });

  ws.on("error", (err) => {
    console.error("Binance stream error:", err.message || err);
  });

  ws.on("close", (code, reason) => {
    console.warn(
      `Binance stream closed (code ${code}${reason ? `, ${reason}` : ""}). ` +
        `Reconnecting in ${reconnectDelayMs}ms.`
    );
    setTimeout(connectBinanceStream, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  });
}

// Runs independently of the WS's own event handlers, since those are
// exactly what fails to fire in the dead-connection case this guards
// against. ws.terminate() forces the socket closed from this end even if
// the remote side never sends a proper close frame — that in turn fires
// this connection's 'close' handler above, which reconnects normally.
setInterval(() => {
  if (!lastMessageAt) return; // haven't connected yet at all — nothing to judge staleness against
  const staleFor = Date.now() - lastMessageAt;
  if (staleFor > STALE_CONNECTION_MS) {
    console.warn(
      `No Binance stream messages in ${Math.round(staleFor / 1000)}s — ` +
        "connection appears dead. Forcing reconnect."
    );
    if (currentWs) currentWs.terminate();
    else connectBinanceStream();
  }
}, WATCHDOG_INTERVAL_MS);

// ---------------------------------------------------------------------------
// HTTP server — Cloud Run requires listening on PORT, and this doubles as
// a health/status check you can hit to confirm the stream is alive.
// ---------------------------------------------------------------------------
const app = express();

app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/status", (req, res) => {
  const staleForMs = lastMessageAt ? Date.now() - lastMessageAt : null;
  res.status(200).json({
    latestPrice,
    activeAlertCount: activeAlerts.length,
    lastCheckedAt,
    lastMessageAt: lastMessageAt || null,
    staleForMs,
    isStale: staleForMs !== null && staleForMs > STALE_CONNECTION_MS,
  });
});

const ALLOWED_KLINE_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

// Historical candles for the dashboard's coin detail page, fetched from
// Binance server-side. This runs in europe-west1 specifically (see the
// file header comment) so the Binance call itself doesn't hit the same
// "geo-blocked cloud IP" wall a US-region function would — and more
// importantly, it means a browser in a country that blocks Binance's
// domains outright (e.g. Nigeria, since Feb 2024) can still get chart
// data, because the browser only ever talks to our own Firebase
// Functions domain, never binance.com directly.
app.get("/klines", async (req, res) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const interval = String(req.query.interval || "1d");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 180, 1), 1000);

  const pair = SYMBOL_TO_BINANCE_REST_PAIR[symbol];
  if (!pair) {
    res.status(400).json({ ok: false, error: `Unsupported symbol: ${symbol}` });
    return;
  }
  if (!ALLOWED_KLINE_INTERVALS.has(interval)) {
    res.status(400).json({ ok: false, error: `Unsupported interval: ${interval}` });
    return;
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
    const binanceRes = await fetch(url);
    if (!binanceRes.ok) {
      throw new Error(`Binance klines request failed: ${binanceRes.status}`);
    }
    const raw = await binanceRes.json();
    const candles = raw.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    res.status(200).json({ ok: true, candles });
  } catch (err) {
    console.error(`Failed to fetch ${symbol} klines:`, err.message || err);
    res.status(502).json({ ok: false, error: "Failed to fetch candles from Binance." });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Status server listening on ${port}`);
  startAlertsListener();
  connectBinanceStream();
});
