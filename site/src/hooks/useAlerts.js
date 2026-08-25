import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";

/** Live list of a chat's active alerts. Updates instantly on any change. */
export function useActiveAlerts(chatId) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chatId) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "alerts"),
      where("chatId", "==", chatId),
      where("active", "==", true)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Failed to load alerts:", err);
        setError(
          `Couldn't load alerts (${err.code || "unknown error"}). ` +
            (err.code === "permission-denied"
              ? "Firestore security rules are blocking reads — they need to be deployed (firebase deploy --only firestore:rules)."
              : "Double check the chat ID with /myid in Telegram, or check the browser console for details.")
        );
        setLoading(false);
      }
    );
    return unsub;
  }, [chatId]);

  return { alerts, loading, error };
}

/** Live list of a chat's most recent triggered alerts. */
export function useAlertHistory(chatId, max = 20) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!chatId) {
      setHistory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "alert_history"),
      where("chatId", "==", chatId),
      orderBy("triggeredAt", "desc"),
      limit(max)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load alert history:", err);
        setError(
          `Couldn't load history (${err.code || "unknown error"}). ` +
            (err.code === "permission-denied"
              ? "Firestore security rules are blocking reads — they need to be deployed (firebase deploy --only firestore:rules)."
              : "Check the browser console for details.")
        );
        setLoading(false);
      }
    );
    return unsub;
  }, [chatId, max]);

  return { history, loading, error };
}
