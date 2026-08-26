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
const alertsCore = require("./alertsCore");
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
const ALLOWED_KLINE_INTERVALS = new Set(["1h", "4h", "1d", "1w"]);

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
      "Send /help anytime for this message again."
  );
}

async function handleHelp(chatId) {
  await sendMessage(
    chatId,
    "*Commands*\n\n" +
      "`/alert <COIN> <above|below> <price> [BUY|SELL] [REPEAT]` — create a price alert\n" +
      "  BUY/SELL is optional and just tags the alert for your own reference\n" +
      "  REPEAT keeps the alert active — it fires again each time price re-crosses your target\n" +
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

async function handleCreateAlert(chatId, args) {
  if (args.length < 3 || args.length > 5) {
    await sendMessage(
      chatId,
      "Usage: `/alert <COIN> <above|below> <price> [BUY|SELL] [REPEAT]`\n" +
        "Example: `/alert BTC above 70000`\n" +
        "Example with label: `/alert BTC below 60000 BUY`\n" +
        "Example repeating: `/alert BTC above 70000 REPEAT`\n\n" +
        "REPEAT alerts fire every time the price crosses your target, " +
        "instead of just once."
    );
    return;
  }

  const [coinRaw, conditionRaw, priceRaw, ...rest] = args;
  const coin = coinRaw.toUpperCase();
  const condition = conditionRaw.toLowerCase();
  const targetPrice = parseFloat(priceRaw);

  // The remaining args (up to 2) can be BUY/SELL and/or REPEAT, in any order.
  let label = null;
  let repeat = false;
  for (const token of rest) {
    const normalized = token.toUpperCase();
    if (["BUY", "SELL"].includes(normalized)) {
      if (label !== null) {
        await sendMessage(chatId, "You can only specify one of `BUY` or `SELL`.");
        return;
      }
      label = normalized;
    } else if (normalized === "REPEAT") {
      repeat = true;
    } else {
      await sendMessage(
        chatId,
        `I didn't understand \`${token}\`. Optional flags are ` +
          "`BUY`, `SELL`, and `REPEAT`."
      );
      return;
    }
  }

  if (!isSupportedAsset(coin)) {
    await sendMessage(
      chatId,
      `I don't support *${coin}* yet. Supported: ${ALL_SUPPORTED_SYMBOLS.join(
        ", "
      )}`
    );
    return;
  }

  if (!["above", "below"].includes(condition)) {
    await sendMessage(chatId, "Condition must be either `above` or `below`.");
    return;
  }

  if (isNaN(targetPrice) || targetPrice <= 0) {
    await sendMessage(chatId, "Please provide a valid target price.");
    return;
  }

  const result = await alertsCore.createAlert({
    chatId,
    coin,
    condition,
    targetPrice,
    label,
    repeat,
  });

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
    `✅ ${labelPrefix}Alert set: *${coin}* ${condition} *$${targetPrice.toLocaleString()}*${repeatSuffix}\n` +
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
    return `\`${doc.id.slice(0, 6)}\` — ${tagPrefix}${d.coin} ${d.condition} $${d.targetPrice.toLocaleString()}${repeatSuffix}`;
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

    const coins = [...new Set(snapshot.docs.map((doc) => doc.data().coin))];
    const prices = await getAssetPrices(coins);

    const triggeredUpdates = [];

    for (const doc of snapshot.docs) {
      const alert = doc.data();
      const currentPrice = prices[alert.coin];
      if (currentPrice === undefined) continue;

      const conditionMet =
        (alert.condition === "above" && currentPrice >= alert.targetPrice) ||
        (alert.condition === "below" && currentPrice <= alert.targetPrice);

      if (!alert.repeat) {
        // One-shot alert: fire once, then deactivate.
        if (conditionMet) {
          triggeredUpdates.push(
            notifyAndDeactivate(doc.ref, alert, currentPrice)
          );
        }
        continue;
      }

      // Repeating alert: only fire while "armed" (i.e. hasn't already
      // notified for this crossing), then re-arm once price moves back
      // to the other side of the target so the next crossing can fire too.
      const armed = alert.armed !== false; // default true for older docs
      if (armed && conditionMet) {
        triggeredUpdates.push(
          notifyAndReArmLater(doc.ref, alert, currentPrice)
        );
      } else if (!armed && !conditionMet) {
        triggeredUpdates.push(doc.ref.update({ armed: true }));
      }
    }

    await Promise.all(triggeredUpdates);
    console.log(
      `Checked ${snapshot.size} alerts, triggered ${triggeredUpdates.length}.`
    );
  }
);

async function notifyAndDeactivate(docRef, alert, currentPrice) {
  const labelPrefix = labelTag(alert.label);

  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!*\n\n` +
      `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
      `your target of $${alert.targetPrice.toLocaleString()}.\n\n` +
      "This alert has been deactivated. Create a new one anytime with `/alert`."
  );

  await docRef.update({
    active: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtPrice: currentPrice,
  });

  await logAlertHistory(alert, currentPrice);
}

async function notifyAndReArmLater(docRef, alert, currentPrice) {
  const labelPrefix = labelTag(alert.label);

  await sendMessage(
    alert.chatId,
    `🚨 *${labelPrefix}${alert.coin} Alert!* 🔁\n\n` +
      `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
      `your target of $${alert.targetPrice.toLocaleString()}.\n\n` +
      "This is a repeating alert — it'll fire again next time price crosses " +
      "your target. Delete it anytime with `/delete`."
  );

  // Mark disarmed so it doesn't re-fire on every check while price stays
  // past the target. It re-arms automatically once price crosses back.
  await docRef.update({
    armed: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtPrice: currentPrice,
  });

  await logAlertHistory(alert, currentPrice);
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
