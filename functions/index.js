const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { sendMessage } = require("./telegram");
const {
  ALL_SUPPORTED_SYMBOLS,
  isSupportedAsset,
  getAssetPrices,
} = require("./assets");
const { isSupportedSymbol } = require("./prices");
const { getKlines } = require("./klines");
const { getIndicatorSnapshot } = require("./indicators");
const alertsCore = require("./alertsCore");
const { PRICE_CONDITIONS, RSI_CONDITIONS, MACD_CONDITIONS } = alertsCore;
const paystack = require("./paystack");
const exchange = require("./exchange");
const crypto = require("crypto");

// Only this chat ID may use trading commands. Trading uses YOUR exchange
// API keys, not the user's — so without this gate, any Telegram user who
// finds the bot could place orders on your account. Get your own with
// /myid.
const OWNER_CHAT_ID = "8906534783";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 5 });

// ---------------------------------------------------------------------------
// Telegram webhook — handles all bot commands
// ---------------------------------------------------------------------------
exports.telegramWebhook = onRequest(
  { secrets: ["TELEGRAM_BOT_TOKEN", "PAYSTACK_SECRET_KEY", "BINANCE_API_KEY", "BINANCE_API_SECRET"] },
  async (req, res) => {
    try {
      const update = req.body;
      const message = update.message;

      if (!message || !message.text) {
        res.status(200).send("ok");
        return;
      }

      const chatId = message.chat.id;
      const text = message.text.trim();

      await handleCommand(chatId, text);
      res.status(200).send("ok");
    } catch (err) {
      console.error("Webhook error:", err);
      // Still respond 200 so Telegram doesn't retry endlessly on our bugs
      res.status(200).send("ok");
    }
  }
);

// ---------------------------------------------------------------------------
// Web dashboard API — lets the React app create/edit/delete alerts.
//
// Ownership check is chatId-based, same "unlisted-link" privacy model the
// rest of the app already uses (see firestore.rules): anyone who has a
// chatId (from /myid in Telegram) can manage alerts under it. There is no
// real user authentication here. All actual Firestore writes stay
// server-side via the Admin SDK, same as the bot — the client never writes
// to Firestore directly.
// ---------------------------------------------------------------------------
const cors = require("cors")({ origin: true });

exports.createAlertApi = onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Use POST." });
      return;
    }
    const result = await alertsCore.createAlert(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });
});

exports.updateAlertApi = onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Use POST." });
      return;
    }
    const result = await alertsCore.updateAlert(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });
});

exports.deleteAlertApi = onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Use POST." });
      return;
    }
    const result = await alertsCore.deleteAlert(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });
});

// ---------------------------------------------------------------------------
// Live prices API — lets the dashboard show the same tick-by-tick prices
// alerts are evaluated against, instead of a slower, separate CoinGecko
// call straight from the browser. Browsers can't hold the identity token
// stream-service requires, so this just proxies through getAssetPrices()
// (coins go stream-service-first with a CoinGecko fallback, same as the
// bot; metals go straight to gold-api.com) and hands back plain JSON.
// Read-only and keyless, so no ownership check needed like the alert CRUD
// endpoints above.
// ---------------------------------------------------------------------------
exports.getLivePricesApi = onRequest(async (req, res) => {
  cors(req, res, async () => {
    const raw = req.query.symbols || "";
    const symbols = String(raw)
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (symbols.length === 0) {
      res.status(400).json({ ok: false, error: "Provide ?symbols=BTC,ETH,..." });
      return;
    }

    try {
      const prices = await getAssetPrices(symbols);
      res.status(200).json({ ok: true, prices, fetchedAt: Date.now() });
    } catch (err) {
      console.error("getLivePricesApi error:", err);
      res.status(500).json({ ok: false, error: "Failed to fetch prices." });
    }
  });
});

// ---------------------------------------------------------------------------
// Historical candles API — coin detail page's chart. Proxies through
// stream-service (europe-west1) rather than letting the browser hit
// Binance directly: Binance's domains are outright blocked at the ISP
// level in some countries (Nigeria since Feb 2024), so a client-side
// fetch to api.binance.com from there just fails. Going through our own
// Functions domain, which isn't blocked, fixes that. Read-only and
// keyless, same as getLivePricesApi above.
// ---------------------------------------------------------------------------
const ALLOWED_KLINE_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);

exports.getKlinesApi = onRequest(async (req, res) => {
  cors(req, res, async () => {
    const symbol = String(req.query.symbol || "").toUpperCase();
    const interval = String(req.query.interval || "1d");
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 180, 1), 500);

    if (!isSupportedSymbol(symbol)) {
      res.status(400).json({ ok: false, error: `Unsupported symbol: ${symbol}` });
      return;
    }
    if (!ALLOWED_KLINE_INTERVALS.has(interval)) {
      res.status(400).json({ ok: false, error: `Unsupported interval: ${interval}` });
      return;
    }

    try {
      const candles = await getKlines(symbol, interval, limit);
      res.status(200).json({ ok: true, candles, fetchedAt: Date.now() });
    } catch (err) {
      console.error("getKlinesApi error:", err);
      res.status(500).json({ ok: false, error: "Failed to fetch candles." });
    }
  });
});

// ---------------------------------------------------------------------------
// Paystack webhook — marks a chatId as paid once a transaction succeeds.
// Always re-verifies with Paystack server-to-server rather than trusting
// the webhook body, and checks the signature so random POSTs to this URL
// can't fake a payment.
// ---------------------------------------------------------------------------
exports.paystackWebhook = onRequest(
  { secrets: ["PAYSTACK_SECRET_KEY"] },
  async (req, res) => {
    try {
      const signature = req.headers["x-paystack-signature"];
      const expected = crypto
        .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
        .update(req.rawBody)
        .digest("hex");

      if (!signature || signature !== expected) {
        console.warn("Paystack webhook: bad signature");
        res.status(401).send("invalid signature");
        return;
      }

      const event = req.body;
      if (event.event === "charge.success") {
        const reference = event.data.reference;
        const verified = await paystack.verifyTransaction(reference);

        if (verified.success && verified.chatId) {
          await db.collection("telegram_users").doc(verified.chatId).set(
            {
              isPaid: true,
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
              lastPaymentReference: verified.reference,
            },
            { merge: true }
          );
          await sendMessage(
            verified.chatId,
            "✅ *Payment received — you're upgraded!*\n\n" +
              "Your active alert limit is now unlimited. Thanks for supporting the bot!"
          );
        }
      }

      res.status(200).send("ok");
    } catch (err) {
      console.error("Paystack webhook error:", err);
      // 200 so Paystack doesn't hammer retries on our bugs; verify-on-read
      // elsewhere means a missed webhook isn't catastrophic.
      res.status(200).send("ok");
    }
  }
);

async function handleCommand(chatId, text) {
  const [command, ...args] = text.split(/\s+/);

  switch (command.toLowerCase()) {
    case "/start":
      await handleStart(chatId);
      break;
    case "/alert":
      await handleCreateAlert(chatId, args);
      break;
    case "/price":
      await handlePrice(chatId, args);
      break;
    case "/myalerts":
      await handleListAlerts(chatId);
      break;
    case "/myid":
      await handleMyId(chatId);
      break;
    case "/upgrade":
      await handleUpgrade(chatId);
      break;
    case "/balance":
      await handleBalance(chatId);
      break;
    case "/buy":
      await handleTrade(chatId, args, "buy");
      break;
    case "/sell":
      await handleTrade(chatId, args, "sell");
      break;
    case "/delete":
      await handleDeleteAlert(chatId, args);
      break;
    case "/help":
      await handleHelp(chatId);
      break;
    default:
      await sendMessage(
        chatId,
        "Sorry, I didn't understand that. Send /help to see available commands."
      );
  }
}

async function handleStart(chatId) {
  await db.collection("telegram_users").doc(String(chatId)).set(
    {
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await sendMessage(
    chatId,
    "*Welcome to the Crypto Alert Bot!* 🔔\n\n" +
      "I'll notify you here when a coin hits a price you care about.\n\n" +
      "*Check a price:*\n" +
      "`/price BTC`\n" +
      "`/price GOLD`\n\n" +
      "*Create an alert:*\n" +
      "`/alert BTC above 70000`\n" +
      "`/alert GOLD above 2700`\n" +
      "`/alert ETH below 3000`\n\n" +
      "*Label it BUY or SELL (optional):*\n" +
      "`/alert BTC below 60000 BUY`\n" +
      "`/alert BTC above 75000 SELL`\n\n" +
      "*See your alerts:*\n" +
      "`/myalerts`\n\n" +
      "*Delete an alert:*\n" +
      "`/delete <id>`\n\n" +
      "*Free plan:* up to 3 active alerts. `/upgrade` for unlimited.\n\n" +
      "You can also alert on RSI, MACD, and percent moves, not just price — send /help for that syntax.\n\n" +
      "Send /help anytime for this message again."
  );
}

async function handleHelp(chatId) {
  await sendMessage(
    chatId,
    "*Commands*\n\n" +
      "`/alert <COIN> <above|below> <price>` — price alert\n" +
      "`/alert <COIN> rsi <below|above> <0-100> [interval]` — RSI alert\n" +
      "`/alert <COIN> macd <bullish|bearish> [interval]` — MACD cross alert\n" +
      "`/alert <COIN> move <percent> <windowMinutes>` — percent-move alert\n" +
      "  All of the above take optional `[BUY|SELL] [REPEAT]` at the end\n" +
      "  BUY/SELL just tags the alert for your own reference\n" +
      "  REPEAT keeps the alert active — it fires again each time the condition is met again\n" +
      "`/price <COIN>` — check the current price before setting an alert (or `/price BTC ETH SOL` for several at once)\n" +
      "`/myalerts` — list your active alerts\n" +
      "`/myid` — get your dashboard ID (to view alerts on the web)\n" +
      "`/delete <id>` — delete an alert by its number\n" +
      "`/upgrade` — remove the 3-alert free limit\n\n" +
      `Supported: ${ALL_SUPPORTED_SYMBOLS.join(", ")}`
  );
}

async function handlePrice(chatId, args) {
  if (args.length === 0) {
    await sendMessage(
      chatId,
      "Usage: `/price <COIN>` or `/price <COIN1> <COIN2> ...`\n" +
        "Example: `/price BTC`\n" +
        "Example: `/price BTC ETH SOL`"
    );
    return;
  }

  // Accept space-separated ("/price BTC ETH") and comma-separated
  // ("/price BTC, ETH, SOL" or "/price BTC,ETH,SOL") — split on commas
  // first, then whitespace, and dedupe.
  const requested = [
    ...new Set(
      args
        .join(" ")
        .split(",")
        .flatMap((s) => s.trim().split(/\s+/))
        .filter(Boolean)
        .map((s) => s.toUpperCase())
    ),
  ];

  const unsupported = requested.filter((s) => !isSupportedAsset(s));
  const supported = requested.filter((s) => isSupportedAsset(s));

  if (supported.length === 0) {
    await sendMessage(
      chatId,
      `I don't support ${unsupported
        .map((s) => `*${s}*`)
        .join(", ")}. Supported: ${ALL_SUPPORTED_SYMBOLS.join(", ")}`
    );
    return;
  }

  const prices = await getAssetPrices(supported);

  const lines = supported.map((coin) => {
    const p = prices[coin];
    return p === undefined
      ? `⚠️ *${coin}*: couldn't fetch right now`
      : `💰 *${coin}*: $${p.toLocaleString()}`;
  });

  if (unsupported.length > 0) {
    lines.push(`\nNot supported: ${unsupported.join(", ")}`);
  }

  await sendMessage(chatId, lines.join("\n"));
}

const ALERT_USAGE =
  "*Price:* `/alert <COIN> <above|below> <price> [BUY|SELL] [REPEAT]`\n" +
  "e.g. `/alert BTC above 70000`\n\n" +
  "*RSI:* `/alert <COIN> rsi <below|above> <0-100> [interval]`\n" +
  "e.g. `/alert BTC rsi below 30 1h`\n\n" +
  "*MACD:* `/alert <COIN> macd <bullish|bearish> [interval]`\n" +
  "e.g. `/alert BTC macd bullish 4h`\n\n" +
  "*Percent move:* `/alert <COIN> move <percent> <windowMinutes>`\n" +
  "e.g. `/alert BTC move 5 60`\n\n" +
  `Interval defaults to \`${alertsCore.DEFAULT_INDICATOR_INTERVAL}\`, one of: ${alertsCore.INDICATOR_INTERVALS.join(", ")}\n` +
  `Window defaults to ${alertsCore.DEFAULT_WINDOW_MINUTES} min, range ${alertsCore.MIN_WINDOW_MINUTES}-${alertsCore.MAX_WINDOW_MINUTES}\n\n` +
  "Any of the above can end with `BUY`, `SELL`, and/or `REPEAT`. " +
  "REPEAT alerts fire every time the condition is met again, instead of just once.";

/**
 * Pulls BUY/SELL/REPEAT flag tokens out of the arg list, wherever they
 * appear, leaving only the positional args each condition type parses
 * itself. Returns { positional, label, repeat, error }.
 */
function extractFlags(args) {
  const positional = [];
  let label = null;
  let repeat = false;
  for (const token of args) {
    const normalized = token.toUpperCase();
    if (["BUY", "SELL"].includes(normalized)) {
      if (label !== null) return { error: "You can only specify one of `BUY` or `SELL`." };
      label = normalized;
    } else if (normalized === "REPEAT") {
      repeat = true;
    } else {
      positional.push(token);
    }
  }
  return { positional, label, repeat };
}

async function handleCreateAlert(chatId, args) {
  if (args.length < 2) {
    await sendMessage(chatId, ALERT_USAGE);
    return;
  }

  const flagResult = extractFlags(args);
  if (flagResult.error) {
    await sendMessage(chatId, flagResult.error);
    return;
  }
  const { positional, label, repeat } = flagResult;

  const [coinRaw, keywordRaw, ...pos] = positional;
  const coin = (coinRaw || "").toUpperCase();
  const keyword = (keywordRaw || "").toLowerCase();

  if (!isSupportedAsset(coin)) {
    await sendMessage(
      chatId,
      `I don't support *${coin}* yet. Supported: ${ALL_SUPPORTED_SYMBOLS.join(", ")}`
    );
    return;
  }

  // Each branch below builds the same shape of params (condition + whatever
  // fields that condition needs) and a human-readable summary line for the
  // confirmation message — alertsCore.createAlert does the real validation,
  // this just gets the right fields to it from Telegram's plain-text args.
  let params;
  let summary;

  if (["above", "below"].includes(keyword)) {
    const targetPrice = parseFloat(pos[0]);
    if (isNaN(targetPrice) || targetPrice <= 0) {
      await sendMessage(chatId, "Please provide a valid target price.\n\n" + ALERT_USAGE);
      return;
    }
    params = { condition: keyword, targetPrice };
    summary = `*${coin}* ${keyword} *$${targetPrice.toLocaleString()}*`;
  } else if (keyword === "rsi") {
    const direction = (pos[0] || "").toLowerCase();
    if (!["below", "above"].includes(direction)) {
      await sendMessage(chatId, "RSI direction must be `below` or `above`.\n\n" + ALERT_USAGE);
      return;
    }
    const threshold = parseFloat(pos[1]);
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
      await sendMessage(chatId, "RSI threshold must be between 0 and 100.\n\n" + ALERT_USAGE);
      return;
    }
    const indicatorInterval = pos[2] || alertsCore.DEFAULT_INDICATOR_INTERVAL;
    params = { condition: `rsi_${direction}`, threshold, indicatorInterval };
    summary = `*${coin}* RSI (${indicatorInterval}) ${direction} *${threshold}*`;
  } else if (keyword === "macd") {
    const direction = (pos[0] || "").toLowerCase();
    if (!["bullish", "bearish"].includes(direction)) {
      await sendMessage(chatId, "MACD direction must be `bullish` or `bearish`.\n\n" + ALERT_USAGE);
      return;
    }
    const indicatorInterval = pos[1] || alertsCore.DEFAULT_INDICATOR_INTERVAL;
    params = { condition: `macd_${direction}_cross`, indicatorInterval };
    summary = `*${coin}* MACD (${indicatorInterval}) turns *${direction}*`;
  } else if (keyword === "move") {
    const threshold = parseFloat(pos[0]);
    if (isNaN(threshold) || threshold <= 0) {
      await sendMessage(chatId, "Percent move must be a positive number.\n\n" + ALERT_USAGE);
      return;
    }
    const windowMinutes =
      pos[1] !== undefined ? parseInt(pos[1], 10) : alertsCore.DEFAULT_WINDOW_MINUTES;
    if (
      isNaN(windowMinutes) ||
      windowMinutes < alertsCore.MIN_WINDOW_MINUTES ||
      windowMinutes > alertsCore.MAX_WINDOW_MINUTES
    ) {
      await sendMessage(
        chatId,
        `Window must be between ${alertsCore.MIN_WINDOW_MINUTES} and ${alertsCore.MAX_WINDOW_MINUTES} minutes.\n\n` +
          ALERT_USAGE
      );
      return;
    }
    params = { condition: "percent_move", threshold, windowMinutes };
    summary = `*${coin}* moves *\u00b1${threshold}%* in *${windowMinutes} min*`;
  } else {
    await sendMessage(
      chatId,
      `I didn't understand \`${keywordRaw}\`. Expected \`above\`, \`below\`, \`rsi\`, \`macd\`, or \`move\`.\n\n` +
        ALERT_USAGE
    );
    return;
  }

  const result = await alertsCore.createAlert({ chatId, coin, ...params, label, repeat });

  if (!result.ok) {
    await sendMessage(chatId, result.error);
    return;
  }

  const labelPrefix = labelTag(label);
  const repeatSuffix = repeat ? " 🔁 (repeating)" : "";
  const currentPriceLine =
    result.currentPrice !== undefined
      ? `\nCurrent price: $${result.currentPrice.toLocaleString()}`
      : "";

  await sendMessage(
    chatId,
    `✅ ${labelPrefix}Alert set: ${summary}${repeatSuffix}\n` +
      `ID: \`${result.id.slice(0, 6)}\`${currentPriceLine}`
  );
}

/**
 * Returns a display prefix for a given label, or an empty string if none.
 * @param {"BUY"|"SELL"|null} label
 */
function labelTag(label) {
  if (label === "BUY") return "🟢 BUY ZONE — ";
  if (label === "SELL") return "🔴 SELL ZONE — ";
  return "";
}

const RSI_CONDITIONS_DISPLAY = ["rsi_below", "rsi_above"];
const MACD_CONDITIONS_DISPLAY = ["macd_bullish_cross", "macd_bearish_cross"];

// Same per-condition-type description logic as evaluateAlert's message
// text and the web dashboard's AlertCard.jsx — three separate places that
// all need to agree on how to describe an alert, since none of them share
// a module (functions/ vs site/src/, plus this one needs to stay terse for
// a Telegram message rather than JSX).
function describeAlertLine(d) {
  if (d.condition === "above" || d.condition === "below") {
    return `${d.coin} ${d.condition} $${d.targetPrice.toLocaleString()}`;
  }
  if (RSI_CONDITIONS_DISPLAY.includes(d.condition)) {
    const direction = d.condition === "rsi_below" ? "below" : "above";
    return `${d.coin} RSI (${d.indicatorInterval}) ${direction} ${d.threshold}`;
  }
  if (MACD_CONDITIONS_DISPLAY.includes(d.condition)) {
    const direction = d.condition === "macd_bullish_cross" ? "bullish" : "bearish";
    return `${d.coin} MACD (${d.indicatorInterval}) turns ${direction}`;
  }
  if (d.condition === "percent_move") {
    return `${d.coin} moves ±${d.threshold}% in ${d.windowMinutes}m`;
  }
  return `${d.coin} ${d.condition}`;
}

async function handleListAlerts(chatId) {
  const snapshot = await db
    .collection("alerts")
    .where("chatId", "==", String(chatId))
    .where("active", "==", true)
    .get();

  if (snapshot.empty) {
    await sendMessage(
      chatId,
      "You have no active alerts. Create one with `/alert BTC above 70000`."
    );
    return;
  }

  const lines = snapshot.docs.map((doc) => {
    const d = doc.data();
    const tag = labelTag(d.label).trim();
    const tagPrefix = tag ? `${tag} ` : "";
    const repeatSuffix = d.repeat ? " 🔁" : "";
    return `\`${doc.id.slice(0, 6)}\` — ${tagPrefix}${describeAlertLine(d)}${repeatSuffix}`;
  });

  await sendMessage(chatId, "*Your active alerts:*\n\n" + lines.join("\n"));
}

async function handleMyId(chatId) {
  await sendMessage(
    chatId,
    "*Your dashboard ID:*\n" +
      `\`${chatId}\`\n\n` +
      "Paste this into the web dashboard to view your alerts there.\n" +
      "Keep it private — anyone with this ID can view (not edit) your alerts on the dashboard."
  );
}

async function handleUpgrade(chatId) {
  const alreadyPaid = await alertsCore.isPaidUser(chatId);
  if (alreadyPaid) {
    await sendMessage(chatId, "You're already upgraded — unlimited alerts are active. 🎉");
    return;
  }

  try {
    const { authorizationUrl } = await paystack.initializeUpgrade(chatId);
    await sendMessage(
      chatId,
      `💳 *Upgrade to unlimited alerts — ₦${paystack.UPGRADE_AMOUNT_NGN.toLocaleString()}*\n\n` +
        `Pay here: ${authorizationUrl}\n\n` +
        "Once payment goes through, I'll message you here automatically — no need to do anything else."
    );
  } catch (err) {
    console.error("Upgrade init failed:", err);
    await sendMessage(
      chatId,
      "Couldn't start the payment right now. Please try again in a moment."
    );
  }
}

async function handleBalance(chatId) {
  if (String(chatId) !== OWNER_CHAT_ID) {
    await sendMessage(chatId, "This command isn't available.");
    return;
  }
  try {
    const balances = await exchange.getBalance();
    const entries = Object.entries(balances);
    const mode = exchange.USE_TESTNET ? "TESTNET (fake funds)" : "⚠️ LIVE";
    if (entries.length === 0) {
      await sendMessage(chatId, `*Balance* (${mode})\n\nNothing to show.`);
      return;
    }
    const lines = entries.map(([asset, amt]) => `${asset}: ${amt}`);
    await sendMessage(chatId, `*Balance* (${mode})\n\n${lines.join("\n")}`);
  } catch (err) {
    console.error("Balance fetch failed:", err);
    await sendMessage(chatId, `Couldn't fetch balance: ${err.message}`);
  }
}

async function handleTrade(chatId, args, side) {
  if (String(chatId) !== OWNER_CHAT_ID) {
    await sendMessage(chatId, "This command isn't available.");
    return;
  }
  if (args.length !== 2) {
    await sendMessage(
      chatId,
      `Usage: \`/${side} <SYMBOL> <AMOUNT>\`\nExample: \`/${side} BTC/USDT 0.001\``
    );
    return;
  }
  const [symbol, amountStr] = args;
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    await sendMessage(chatId, "Amount must be a positive number.");
    return;
  }

  const mode = exchange.USE_TESTNET ? "TESTNET" : "⚠️ LIVE — REAL FUNDS";
  try {
    const order = await exchange.placeMarketOrder(symbol, side, amount);
    await sendMessage(
      chatId,
      `✅ *${side.toUpperCase()} order placed* (${mode})\n\n` +
        `${symbol} — ${amount}\n` +
        `Order ID: \`${order.id}\`\n` +
        `Status: ${order.status || "submitted"}`
    );
  } catch (err) {
    console.error("Trade failed:", err);
    await sendMessage(chatId, `Order failed: ${err.message}`);
  }
}

async function handleDeleteAlert(chatId, args) {
  if (args.length !== 1) {
    await sendMessage(chatId, "Usage: `/delete <id>` (see `/myalerts` for IDs)");
    return;
  }

  const shortId = args[0];
  const snapshot = await db
    .collection("alerts")
    .where("chatId", "==", String(chatId))
    .where("active", "==", true)
    .get();

  // Case-insensitive match — Firestore doc IDs are mixed-case, and it's
  // easy to mistype/mis-capitalize a character when typing a 6-char ID
  // on a phone keyboard.
  const match = snapshot.docs.find((doc) =>
    doc.id.toLowerCase().startsWith(shortId.toLowerCase())
  );

  if (!match) {
    await sendMessage(chatId, "No matching alert found. Check `/myalerts` for valid IDs.");
    return;
  }

  await match.ref.update({ active: false });
  await sendMessage(chatId, "🗑️ Alert deleted.");
}

// Number of candles fetched for an RSI/MACD read — indicators.js needs
// 51+ to produce the SMA50 trend leg, so 100 leaves comfortable headroom.
const INDICATOR_CANDLE_LIMIT = 100;

/**
 * Figures out whether a single alert's condition is currently true, and
 * builds the human-readable line describing why. Returns null if the data
 * needed to evaluate it isn't available this cycle (e.g. a klines fetch
 * failed) — the caller skips the alert entirely for this check rather than
 * treating "unknown" as "not met", so a transient fetch failure can't
 * silently re-arm or fire anything.
 */
function evaluateAlert(alert, { prices, indicatorSnapshots, percentMoves }) {
  if (PRICE_CONDITIONS.includes(alert.condition)) {
    const currentPrice = prices[alert.coin];
    if (currentPrice === undefined) return null;
    const met =
      (alert.condition === "above" && currentPrice >= alert.targetPrice) ||
      (alert.condition === "below" && currentPrice <= alert.targetPrice);
    return {
      met,
      currentValue: currentPrice,
      message:
        `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
        `your target of $${alert.targetPrice.toLocaleString()}.`,
    };
  }

  if (RSI_CONDITIONS.includes(alert.condition)) {
    const snap = indicatorSnapshots.get(`${alert.coin}:${alert.indicatorInterval}`);
    if (!snap) return null;
    const met =
      (alert.condition === "rsi_below" && snap.rsi <= alert.threshold) ||
      (alert.condition === "rsi_above" && snap.rsi >= alert.threshold);
    const direction = alert.condition === "rsi_below" ? "at or below" : "at or above";
    return {
      met,
      currentValue: snap.rsi,
      message:
        `${alert.coin}'s RSI (${alert.indicatorInterval}) is now ${snap.rsi.toFixed(1)}, ` +
        `which is ${direction} your threshold of ${alert.threshold}.`,
    };
  }

  if (MACD_CONDITIONS.includes(alert.condition)) {
    const snap = indicatorSnapshots.get(`${alert.coin}:${alert.indicatorInterval}`);
    if (!snap) return null;
    const bullish = snap.macd > snap.signal;
    const met =
      (alert.condition === "macd_bullish_cross" && bullish) ||
      (alert.condition === "macd_bearish_cross" && !bullish);
    return {
      met,
      currentValue: snap.histogram,
      message:
        `${alert.coin}'s MACD (${alert.indicatorInterval}) just turned ${bullish ? "bullish" : "bearish"} ` +
        `— MACD ${snap.macd.toFixed(4)} vs. signal ${snap.signal.toFixed(4)}.`,
    };
  }

  if (alert.condition === "percent_move") {
    const move = percentMoves.get(`${alert.coin}:${alert.windowMinutes}`);
    if (move === undefined) return null;
    const met = Math.abs(move) >= alert.threshold;
    return {
      met,
      currentValue: move,
      message:
        `${alert.coin} has moved ${move >= 0 ? "+" : ""}${move.toFixed(2)}% in the last ` +
        `${alert.windowMinutes} minutes, past your ${alert.threshold}% threshold.`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Scheduled price checker — runs every 1 minute
// ---------------------------------------------------------------------------
exports.checkPrices = onSchedule(
  { schedule: "every 1 minutes", secrets: ["TELEGRAM_BOT_TOKEN"] },
  async () => {
    const snapshot = await db
      .collection("alerts")
      .where("active", "==", true)
      .get();

    if (snapshot.empty) {
      console.log("No active alerts to check.");
      return;
    }

    const alerts = snapshot.docs.map((doc) => ({ ref: doc.ref, data: doc.data() }));

    // Price alerts: one batched price fetch, same as before.
    const priceCoins = [
      ...new Set(alerts.filter((a) => PRICE_CONDITIONS.includes(a.data.condition)).map((a) => a.data.coin)),
    ];
    const prices = priceCoins.length ? await getAssetPrices(priceCoins) : {};

    // RSI/MACD alerts: batch by unique (coin, interval) pair so five alerts
    // on BTC/1h only cost one klines fetch, not five.
    const indicatorAlerts = alerts.filter(
      (a) => RSI_CONDITIONS.includes(a.data.condition) || MACD_CONDITIONS.includes(a.data.condition)
    );
    const indicatorPairs = [...new Set(indicatorAlerts.map((a) => `${a.data.coin}:${a.data.indicatorInterval}`))];
    const indicatorSnapshots = new Map();
    await Promise.all(
      indicatorPairs.map(async (key) => {
        const [coin, interval] = key.split(":");
        const candles = await getKlines(coin, interval, INDICATOR_CANDLE_LIMIT);
        const snap = getIndicatorSnapshot(candles);
        if (snap) indicatorSnapshots.set(key, snap);
      })
    );

    // Percent-move alerts: batch by unique (coin, windowMinutes) pair.
    // Always reads 1m candles regardless of window length — comparing the
    // oldest close in a `windowMinutes`-sized slice of 1m candles to the
    // newest gives the % move over exactly that window.
    const percentAlerts = alerts.filter((a) => a.data.condition === "percent_move");
    const percentPairs = [...new Set(percentAlerts.map((a) => `${a.data.coin}:${a.data.windowMinutes}`))];
    const percentMoves = new Map();
    await Promise.all(
      percentPairs.map(async (key) => {
        const [coin, windowStr] = key.split(":");
        const window = Number(windowStr);
        const candles = await getKlines(coin, "1m", window + 1);
        if (candles.length < 2) return;
        const first = candles[0].close;
        const last = candles[candles.length - 1].close;
        if (first > 0) percentMoves.set(key, ((last - first) / first) * 100);
      })
    );

    const context = { prices, indicatorSnapshots, percentMoves };
    const triggeredUpdates = [];

    for (const { ref, data: alert } of alerts) {
      const evaluation = evaluateAlert(alert, context);
      if (!evaluation) continue; // data unavailable this cycle — skip, don't guess

      if (!alert.repeat) {
        // One-shot alert: fire once, then deactivate.
        if (evaluation.met) {
          triggeredUpdates.push(notifyAndDeactivate(ref, alert, evaluation));
        }
        continue;
      }

      // Repeating alert: only fire while "armed" (i.e. hasn't already
      // notified for this crossing), then re-arm once the condition is no
      // longer true so the next crossing can fire too.
      const armed = alert.armed !== false; // default true for older docs
      if (armed && evaluation.met) {
        triggeredUpdates.push(notifyAndReArmLater(ref, alert, evaluation));
      } else if (!armed && !evaluation.met) {
        triggeredUpdates.push(ref.update({ armed: true }));
      }
    }

    await Promise.all(triggeredUpdates);
    console.log(
      `Checked ${snapshot.size} alerts, triggered ${triggeredUpdates.length}.`
    );
  }
);

async function notifyAndDeactivate(docRef, alert, evaluation) {
  const labelPrefix = labelTag(alert.label);

  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!*\n\n` +
      `${evaluation.message}\n\n` +
      "This alert has been deactivated. Create a new one anytime with `/alert`."
  );

  await docRef.update({
    active: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtValue: evaluation.currentValue,
  });

  await logAlertHistory(alert, evaluation.currentValue);
}

async function notifyAndReArmLater(docRef, alert, evaluation) {
  const labelPrefix = labelTag(alert.label);

  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!* 🔁\n\n` +
      `${evaluation.message}\n\n` +
      "This is a repeating alert — it'll fire again next time the condition is met. " +
      "Delete it anytime with `/delete`."
  );

  // Mark disarmed so it doesn't re-fire on every check while the condition
  // stays true. It re-arms automatically once the condition is no longer met.
  await docRef.update({
    armed: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtValue: evaluation.currentValue,
  });

  await logAlertHistory(alert, evaluation.currentValue);
}

async function logAlertHistory(alert, currentValue) {
  await db.collection("alert_history").add({
    chatId: alert.chatId,
    coin: alert.coin,
    condition: alert.condition,
    targetPrice: alert.targetPrice ?? null,
    threshold: alert.threshold ?? null,
    indicatorInterval: alert.indicatorInterval ?? null,
    windowMinutes: alert.windowMinutes ?? null,
    label: alert.label || null,
    repeat: Boolean(alert.repeat),
    triggeredAtValue: currentValue,
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
