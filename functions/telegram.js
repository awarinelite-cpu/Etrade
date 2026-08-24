const fetch = require("node-fetch");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Send a plain text message to a Telegram chat.
 * @param {string|number} chatId - Telegram chat ID to send to.
 * @param {string} text - Message text (Markdown supported).
 */
async function sendMessage(chatId, text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("Telegram sendMessage failed:", data);
  }
  return data;
}

module.exports = { sendMessage };
