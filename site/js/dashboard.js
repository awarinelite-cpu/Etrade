import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lookupView = document.getElementById("lookup-view");
const alertsView = document.getElementById("alerts-view");
const loadingView = document.getElementById("loading-view");

const lookupForm = document.getElementById("lookup-form");
const chatIdInput = document.getElementById("chat-id-input");
const lookupError = document.getElementById("lookup-error");
const changeIdBtn = document.getElementById("change-id-btn");

const activeList = document.getElementById("active-list");
const activeEmpty = document.getElementById("active-empty");
const activeCount = document.getElementById("active-count");

const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const historyCount = document.getElementById("history-count");

const STORAGE_KEY = "signal_dashboard_chat_id";

function showView(view) {
  lookupView.hidden = view !== "lookup";
  alertsView.hidden = view !== "alerts";
  loadingView.hidden = view !== "loading";
}

function tagBadge(label) {
  if (label === "BUY") return '<span class="alert-tag buy">BUY</span>';
  if (label === "SELL") return '<span class="alert-tag sell">SELL</span>';
  return "";
}

function formatPrice(n) {
  if (typeof n !== "number") return "—";
  return `$${n.toLocaleString()}`;
}

function formatTimestamp(ts) {
  if (!ts || !ts.toDate) return "";
  return ts.toDate().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderActiveAlert(data) {
  const card = document.createElement("div");
  card.className = "alert-card";
  card.innerHTML = `
    <div class="alert-card-top">
      <span class="alert-coin">${data.coin}</span>
      ${tagBadge(data.label)}
    </div>
    <div class="alert-detail">${data.condition} ${formatPrice(data.targetPrice)}</div>
    <div class="alert-meta">Created ${formatTimestamp(data.createdAt)}</div>
  `;
  return card;
}

function renderHistoryAlert(data) {
  const card = document.createElement("div");
  card.className = "alert-card";
  card.innerHTML = `
    <div class="alert-card-top">
      <span class="alert-coin">${data.coin}</span>
      ${tagBadge(data.label)}
    </div>
    <div class="alert-detail">
      Triggered at ${formatPrice(data.triggeredAtPrice)}
      (target: ${data.condition} ${formatPrice(data.targetPrice)})
    </div>
    <div class="alert-meta">${formatTimestamp(data.triggeredAt)}</div>
  `;
  return card;
}

async function loadAlerts(chatId) {
  showView("loading");
  lookupError.hidden = true;

  try {
    const activeQuery = query(
      collection(db, "alerts"),
      where("chatId", "==", chatId),
      where("active", "==", true)
    );

    const historyQuery = query(
      collection(db, "alert_history"),
      where("chatId", "==", chatId),
      orderBy("triggeredAt", "desc"),
      limit(20)
    );

    const [activeSnap, historySnap] = await Promise.all([
      getDocs(activeQuery),
      getDocs(historyQuery),
    ]);

    activeList.innerHTML = "";
    historyList.innerHTML = "";

    activeCount.textContent = activeSnap.size;
    historyCount.textContent = historySnap.size;

    if (activeSnap.empty) {
      activeEmpty.hidden = false;
    } else {
      activeEmpty.hidden = true;
      activeSnap.forEach((doc) => {
        activeList.appendChild(renderActiveAlert(doc.data()));
      });
    }

    if (historySnap.empty) {
      historyEmpty.hidden = false;
    } else {
      historyEmpty.hidden = true;
      historySnap.forEach((doc) => {
        historyList.appendChild(renderHistoryAlert(doc.data()));
      });
    }

    showView("alerts");
  } catch (err) {
    console.error("Failed to load alerts:", err);
    showView("lookup");
    lookupError.hidden = false;
    lookupError.textContent =
      "Couldn't load alerts for that ID. Double check it with /myid in Telegram and try again.";
  }
}

lookupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const chatId = chatIdInput.value.trim();
  if (!chatId) return;

  localStorage.setItem(STORAGE_KEY, chatId);
  loadAlerts(chatId);
});

changeIdBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  chatIdInput.value = "";
  showView("lookup");
});

// On load, auto-resume the last-used ID if we have one saved locally.
const savedChatId = localStorage.getItem(STORAGE_KEY);
if (savedChatId) {
  chatIdInput.value = savedChatId;
  loadAlerts(savedChatId);
} else {
  showView("lookup");
}
