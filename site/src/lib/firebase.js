// Firebase web config is safe to expose in client-side code — it identifies
// the project, it does not authenticate as an admin. Access control is
// enforced by Firestore Security Rules (see /firestore.rules), which allow
// public reads on alerts/alert_history (unlisted-link privacy, scoped by
// chatId) and block all client writes. Writes go through the Cloud
// Functions HTTP API instead — see src/lib/api.js.
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBp1jqWXwjwEU5J9c-iM967tdXg6EgLPhw",
  authDomain: "e-trading-f5bec.firebaseapp.com",
  projectId: "e-trading-f5bec",
  storageBucket: "e-trading-f5bec.firebasestorage.app",
  messagingSenderId: "514319786782",
  appId: "1:514319786782:web:4ff9a987efdb4340ba9f0f",
  measurementId: "G-B4N2WRMQ5B",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
