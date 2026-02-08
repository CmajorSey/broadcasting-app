// src/lib/soundRouter.js
// Central sound router
// SIMPLE RULES (for now):
// - All NON-ticket notifications → lo_leave_approved.wav
// - Urgent admin notifications → lo_notify_urgent.wav
// - ALL ticket notifications → lo_ticket_assigned.wav
// - Sound plays ONLY for global notifications

const STORAGE_SOUNDS_ENABLED = "notificationSoundsEnabled"; // "true" / "false"

// 🔊 Sound library
const SOUND = {
  generic: "/sounds/lo_leave_approved.wav",
  urgent: "/sounds/lo_notify_urgent.wav",
  // ✅ Tickets: single sound for now (per your rule)
  ticket: "/sounds/lo_ticket_assigned.mp3",
};

// ✅ Ticket label → sound mapping (future-proof)
// Later you can change only the right-hand side values per label.
const TICKET_SOUND_MAP = {
  Assigned: SOUND.ticket,
  Updated: SOUND.ticket,
  Modified: SOUND.ticket, // alias (optional but helpful)
  Postponed: SOUND.ticket,
  Cancelled: SOUND.ticket,
  Completed: SOUND.ticket,
};

const audioCache = new Map(); // url -> Audio

// -----------------------------
// Preferences
// -----------------------------
export const isSoundEnabled = () =>
  localStorage.getItem(STORAGE_SOUNDS_ENABLED) !== "false";

export const setSoundEnabled = (enabled) => {
  localStorage.setItem(STORAGE_SOUNDS_ENABLED, enabled ? "true" : "false");
};

// -----------------------------
// Audio unlock (browser autoplay)
// -----------------------------
let _unlockInstalled = false;
let _unlocked = false;

export const installSoundUnlockOnGesture = () => {
  if (_unlockInstalled) return;
  _unlockInstalled = true;

  // IMPORTANT:
  // Do NOT use { once:true } here, because the first user gesture might happen
  // while sounds are disabled. If that happens, the listener is removed and
  // sounds will NEVER unlock later even if the user enables them.
  const handler = async () => {
    if (_unlocked) return;
    if (!isSoundEnabled()) return;

    try {
      await unlockSounds();
    } catch {
      // keep listeners; user can try again on next gesture
    }

    // remove listeners ONLY after a successful unlock
    if (_unlocked) {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    }
  };

  window.addEventListener("pointerdown", handler, { passive: true });
  window.addEventListener("keydown", handler);
};

export const unlockSounds = async () => {
  try {
    const a = new Audio(SOUND.generic);

    // Using muted warmup is more reliable than volume=0 in some setups
    a.muted = true;
    a.preload = "auto";

    const p = a.play(); // must be called in the gesture chain
    if (p && typeof p.then === "function") await p;

    a.pause();
    a.currentTime = 0;

    _unlocked = true;
  } catch {
    _unlocked = false;
  }
};


// -----------------------------
// Sound selection (INTENT ONLY)
// -----------------------------
/**
 * Expected input shape:
 * {
 *   category: "ticket" | "leave" | "fleet" | "admin" | "suggestion" | "system",
 *   urgent: boolean,
 *   scope: "global" | "inbox"
 * }
 */
const pickSoundUrl = (input = {}) => {
  const category = String(input.category || "admin").toLowerCase();

  // 🔕 Inbox-only notifications never play sound
  if (input.scope !== "global") return null;

  // 🔒 Urgent admin/system override (ONLY)
  if (input.urgent && (category === "admin" || category === "system")) return SOUND.urgent;

  // 🎟️ Tickets (all states, one sound for now)
  if (category === "ticket") {
    const label = input.action || input.label || input.state || input.eventLabel || null;
    if (label && TICKET_SOUND_MAP[label]) return TICKET_SOUND_MAP[label];
    return SOUND.ticket;
  }

  // ✅ Everything else
  return SOUND.generic;
};


// -----------------------------
// Playback
// -----------------------------
export const playSoundFor = async (input = {}, opts = {}) => {
  const enabled =
    typeof opts.enabled === "boolean" ? opts.enabled : isSoundEnabled();

  if (!enabled) return;

  const url = pickSoundUrl(input);
  if (!url) return;

  try {
    // If browser still considers audio locked, try to unlock first.
    // (This is safe; if already unlocked it’s basically a no-op.)
    if (!_unlocked) {
      await unlockSounds();
    }

    let base = audioCache.get(url);

    // Create and cache the base audio element
    if (!base) {
      base = new Audio(url);
      base.preload = "auto";
      base.volume = 0.85;
      audioCache.set(url, base);
    }

    // If the cached audio is already playing, clone a one-off instance
    // so rapid notifications don't cancel each other / cause play() rejects.
    const audio =
      !base.paused && !base.ended ? new Audio(url) : base;

    audio.volume = 0.85;
    audio.pause?.();
    audio.currentTime = 0;

    const p = audio.play();
    if (p && typeof p.then === "function") await p;

    _unlocked = true;
  } catch {
    _unlocked = false;
  }
};
