// server/firebaseAdmin.js
import admin from "firebase-admin";

let inited = false;

export function initFirebaseAdmin() {
  if (inited) return admin;

  // Option A: service account JSON as env (recommended for Render)
  // Put the FULL JSON string in FIREBASE_SERVICE_ACCOUNT_JSON
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const serviceAccount = JSON.parse(raw);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  inited = true;
  return admin;
}
