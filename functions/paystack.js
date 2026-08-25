const fetch = require("node-fetch");

const PAYSTACK_API = "https://api.paystack.co";

// Set with: firebase functions:secrets:set PAYSTACK_SECRET_KEY
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Naira amount for the upgrade. Paystack takes amounts in kobo (x100).
// Adjust to whatever price you land on.
const UPGRADE_AMOUNT_NGN = 2000;

/**
 * Start a Paystack transaction for a chatId and return the checkout URL to
 * send the user. We don't have their email (Telegram doesn't give us one),
 * so we use a placeholder — Paystack allows this for card/bank transfer
 * checkout, it's just not used to email a receipt.
 */
async function initializeUpgrade(chatId) {
  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `telegram-${chatId}@placeholder.invalid`,
      amount: UPGRADE_AMOUNT_NGN * 100,
      currency: "NGN",
      metadata: { chatId: String(chatId) },
      // Paystack requires a callback_url; the user is paying from a
      // Telegram-shared link in their browser, so just send them back
      // to the bot afterward. Nothing functionally depends on this page.
      callback_url: "https://t.me/E_TradingSignalAlertsBot",
    }),
  });
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack initialize failed");
  }
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
  };
}

/**
 * Verify a transaction reference directly with Paystack (never trust the
 * webhook payload's "success" claim alone — always re-check server to
 * server) and return the chatId it was for if the payment succeeded.
 */
async function verifyTransaction(reference) {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${SECRET_KEY}` } }
  );
  const data = await res.json();
  if (!data.status) {
    throw new Error(data.message || "Paystack verify failed");
  }
  const tx = data.data;
  const chatId = tx.metadata && tx.metadata.chatId;
  return {
    success: tx.status === "success",
    chatId: chatId ? String(chatId) : null,
    amount: tx.amount,
    reference: tx.reference,
  };
}

module.exports = { initializeUpgrade, verifyTransaction, UPGRADE_AMOUNT_NGN };
