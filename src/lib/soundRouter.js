// src/lib/soundRouter.js
// Single sound router + player (Vite public/ -> served from "/sounds/...")

const STORAGE_SOUNDS_ENABLED = "notificationSoundsEnabled"; // "true"/"false"

const SOUND = {
  notify_new: "/sounds/lo_notify_new.mp3",
  notify_urgent: "/sounds/lo_notify_urgent.mp3",

  ticket_assigned: "/sounds/lo_ticket_assigned.mp3",
  ticket_updated: "/sounds/lo_ticket_updated.mp3",
  ticket_cancelled: "/sounds/lo_ticket_cancelled.mp3",
  ticket_completed: "/sounds/lo_ticket_completed.mp3",

  fleet_rental_warning: "/sounds/lo_fleet_rental_warning.mp3",
  fleet_rental_expired: "/sounds/lo_fleet_rental_expired.mp3",

  leave_submitted: "/sounds/lo_leave_submitted.mp3",
  leave_approved: "/sounds/lo_leave_approved.mp3",
  leave_denied: "/sounds/lo_leave_denied.mp3",

  auth_password_reset_request: "/sounds/lo_auth_password_reset_request.mp3",

  suggestion_new: "/sounds/lo_suggestion_new.mp3",
};

const audioCache = new Map(); // url -> Audio

const safeLower = (v) => String(v || "").toLowerCase();

// --- unlock state (per tab/session) ---
let _unlockAttempted = false;
let _unlocked = false;
let _unlockInstalled = false;

export const isSoundEnabled = () => {
  // default ON unless explicitly set to "false"
  return localStorage.getItem(STORAGE_SOUNDS_ENABLED) !== "false";
};

export const setSoundEnabled = (enabled) => {
  localStorage.setItem(STORAGE_SOUNDS_ENABLED, enabled ? "true" : "false");
};

export const isAudioUnlocked = () => _unlocked;

const pickSoundKey = (input = {}) => {
  // Highest priority: explicit soundKey (future-proof)
  const explicit = input?.soundKey || input?.data?.soundKey;
  if (explicit && SOUND[explicit]) return explicit;

  // Normalize common fields
  const kind = safeLower(input?.kind);
  const title = safeLower(input?.title);
  const message = safeLower(input?.message || input?.body || input?.description);

  // Password reset request (you already use kind on these)
  if (kind === "password_reset_request") return "auth_password_reset_request";

  // Suggestions
  if (kind.includes("suggest") || title.includes("suggestion")) return "suggestion_new";

  // Fleet rental notices
  if (title.includes("rental") || message.includes("rental")) {
    if (title.includes("expired") || message.includes("expired") || title.includes("yesterday")) {
      return "fleet_rental_expired";
    }
    return "fleet_rental_warning";
  }

  // Leave decisions
  if (title.includes("leave") || message.includes("leave")) {
    if (title.includes("approved") || message.includes("approved")) return "leave_approved";
    if (title.includes("denied") || message.includes("denied")) return "leave_denied";
    if (title.includes("submitted") || message.includes("submitted")) return "leave_submitted";
  }

  // Tickets
  if (title.includes("ticket") || message.includes("ticket")) {
    if (title.includes("assigned") || message.includes("assigned")) return "ticket_assigned";
    if (title.includes("cancel") || message.includes("cancel")) return "ticket_cancelled";
    if (title.includes("complete") || message.includes("complete")) return "ticket_completed";
    return "ticket_updated";
  }

  // Urgent
  if (title.includes("urgent") || message.includes("urgent")) return "notify_urgent";

  // Default
  return "notify_new";
};

export const getSoundUrl = (input = {}) => {
  const key = pickSoundKey(input);
  return SOUND[key] || null;
};

// ✅ Install a one-time unlock attempt on the first user gesture anywhere.
// Call this early (e.g., in MyProfile useEffect) — it won't play sound until the user taps/clicks.
export const installSoundUnlockOnGesture = () => {
  if (_unlockInstalled) return;
  _unlockInstalled = true;

  const handler = async () => {
    // Only try if sounds are enabled
    if (!isSoundEnabled()) return;

    try {
      await unlockSounds();
    } catch {
      // ignore
    }
  };

  // pointerdown covers mouse + touch; keydown covers keyboard navigation
  window.addEventListener("pointerdown", handler, { once: true, passive: true });
  window.addEventListener("keydown", handler, { once: true });
};

export const unlockSounds = async () => {
  // Best-effort: try to unlock audio playback on user gesture
  // IMPORTANT: this must run inside a user gesture (click/tap/keydown).
  if (_unlockAttempted && _unlocked) return;

  _unlockAttempted = true;

  try {
    const url = SOUND.notify_new;
    if (!url) return;

    const a = new Audio(url);
    a.preload = "auto";
    a.volume = 0.0; // silent unlock
    await a.play();
    a.pause();
    a.currentTime = 0;

    _unlocked = true;
  } catch {
    // If we hit autoplay lock, keep unlocked=false (we'll retry on next gesture)
    _unlocked = false;
  }
};

export const playSoundFor = async (input = {}, opts = {}) => {
  const enabled = typeof opts.enabled === "boolean" ? opts.enabled : isSoundEnabled();
  if (!enabled) return;

  const url = getSoundUrl(input);
  if (!url) return;

  try {
    let a = audioCache.get(url);
    if (!a) {
      a = new Audio(url);
      a.preload = "auto";
      a.volume = 0.85;
      audioCache.set(url, a);
    }

    // restart so repeated notifications still play
    a.pause();
    a.currentTime = 0;

    await a.play();
    _unlocked = true; // if play succeeded, audio is definitely unlocked
  } catch {
    // Autoplay lock or missing file — do NOT crash
    // If autoplay locked, user needs to interact once; installSoundUnlockOnGesture helps that.
    _unlocked = false;
  }
};