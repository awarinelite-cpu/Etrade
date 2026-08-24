// Firebase web config is safe to expose in client-side code — it identifies
// the project, it does not authenticate as an admin. Access control is
// enforced separately by Firestore Security Rules, not by hiding this file.
//
// See: firestore.rules in this repo for the rules that make the dashboard's
// read-only, ID-scoped access actually safe.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
