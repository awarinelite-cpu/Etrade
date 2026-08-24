const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

const { sendMessage } = require("./telegram");
const { getPrices, isSupportedSymbol, SYMBOL_TO_ID } = require("./prices");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 5 });

const FREE_TIER_ALERT_LIMIT = 3;

// ---------------------------------------------------------------------------
// Telegram webhook — handles all bot commands
// ---------------------------------------------------------------------------
exports.telegramWebhook = onRequest(
  { secrets: ["TELEGRAM_BOT_TOKEN"] },
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

async function handleCommand(chatId, text) {
  const [command, ...args] = text.split(/\s+/);

  switch (command.toLowerCase()) {
    case "/start":
      await handleStart(chatId);
      break;
    case "/alert":
      await handleCreateAlert(chatId, args);
      break;
    case "/myalerts":
      await handleListAlerts(chatId);
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
      "*Create an alert:*\n" +
      "`/alert BTC above 70000`\n" +
      "`/alert ETH below 3000`\n\n" +
      "*See your alerts:*\n" +
      "`/myalerts`\n\n" +
      "*Delete an alert:*\n" +
      "`/delete <id>`\n\n" +
      "Send /help anytime for this message again."
  );
}

async function handleHelp(chatId) {
  await sendMessage(
    chatId,
    "*Commands*\n\n" +
      "`/alert <COIN> <above|below> <price>` — create a price alert\n" +
      "`/myalerts` — list your active alerts\n" +
      "`/delete <id>` — delete an alert by its number\n\n" +
      `Supported coins: ${Object.keys(SYMBOL_TO_ID).join(", ")}`
  );
}

async function handleCreateAlert(chatId, args) {
  if (args.length !== 3) {
    await sendMessage(
      chatId,
      "Usage: `/alert <COIN> <above|below> <price>`\nExample: `/alert BTC above 70000`"
    );
    return;
  }

  const [coinRaw, conditionRaw, priceRaw] = args;
  const coin = coinRaw.toUpperCase();
  const condition = conditionRaw.toLowerCase();
  const targetPrice = parseFloat(priceRaw);

  if (!isSupportedSymbol(coin)) {
    await sendMessage(
      chatId,
      `I don't support *${coin}* yet. Supported coins: ${Object.keys(
        SYMBOL_TO_ID
      ).join(", ")}`
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

  // Enforce free tier limit
  const existingAlerts = await db
    .collection("alerts")
    .where("chatId", "==", String(chatId))
    .where("active", "==", true)
    .get();

  const isPaid = await isPaidUser(chatId);
  if (!isPaid && existingAlerts.size >= FREE_TIER_ALERT_LIMIT) {
    await sendMessage(
      chatId,
      `Free plan allows up to ${FREE_TIER_ALERT_LIMIT} active alerts. ` +
        "Delete one with `/delete <id>` or upgrade to add more."
    );
    return;
  }

  const docRef = await db.collection("alerts").add({
    chatId: String(chatId),
    coin,
    condition,
    targetPrice,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastTriggeredAt: null,
  });

  await sendMessage(
    chatId,
    `✅ Alert set: *${coin}* ${condition} *$${targetPrice.toLocaleString()}*\n` +
      `ID: \`${docRef.id.slice(0, 6)}\``
  );
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
    return `\`${doc.id.slice(0, 6)}\` — ${d.coin} ${d.condition} $${d.targetPrice.toLocaleString()}`;
  });

  await sendMessage(chatId, "*Your active alerts:*\n\n" + lines.join("\n"));
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

  const match = snapshot.docs.find((doc) => doc.id.startsWith(shortId));

  if (!match) {
    await sendMessage(chatId, "No matching alert found. Check `/myalerts` for valid IDs.");
    return;
  }

  await match.ref.update({ active: false });
  await sendMessage(chatId, "🗑️ Alert deleted.");
}

async function isPaidUser(chatId) {
  const doc = await db.collection("telegram_users").doc(String(chatId)).get();
  return Boolean(doc.exists && doc.data().isPaid);
}

// ---------------------------------------------------------------------------
// Scheduled price checker — runs every 5 minutes
// ---------------------------------------------------------------------------
exports.checkPrices = onSchedule(
  { schedule: "every 5 minutes", secrets: ["TELEGRAM_BOT_TOKEN"] },
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
    const prices = await getPrices(coins);

    const triggeredUpdates = [];

    for (const doc of snapshot.docs) {
      const alert = doc.data();
      const currentPrice = prices[alert.coin];
      if (currentPrice === undefined) continue;

      const shouldTrigger =
        (alert.condition === "above" && currentPrice >= alert.targetPrice) ||
        (alert.condition === "below" && currentPrice <= alert.targetPrice);

      if (shouldTrigger) {
        triggeredUpdates.push(
          notifyAndDeactivate(doc.ref, alert, currentPrice)
        );
      }
    }

    await Promise.all(triggeredUpdates);
    console.log(
      `Checked ${snapshot.size} alerts, triggered ${triggeredUpdates.length}.`
    );
  }
);

async function notifyAndDeactivate(docRef, alert, currentPrice) {
  await sendMessage(
    alert.chatId,
    `🚨 *${alert.coin} Alert!*\n\n` +
      `${alert.coin} is now $${currentPrice.toLocaleString()}, which is ${alert.condition} ` +
      `your target of $${alert.targetPrice.toLocaleString()}.\n\n` +
      "This alert has been deactivated. Create a new one anytime with `/alert`."
  );

  await docRef.update({
    active: false,
    lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggeredAtPrice: currentPrice,
  });

  // Log to history for future reference / analytics
  await db.collection("alert_history").add({
    chatId: alert.chatId,
    coin: alert.coin,
    condition: alert.condition,
    targetPrice: alert.targetPrice,
    triggeredAtPrice: currentPrice,
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
