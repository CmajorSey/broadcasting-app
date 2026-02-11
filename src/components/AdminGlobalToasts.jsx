// src/components/AdminGlobalToasts.jsx
// v0.7.2 — Singleton poller (30s), tab-aware pause,
//          password-reset toasts (CLICK toast to open User Management),
//          + rental ending toasts (admins & drivers) (CLICK toast to open Fleet)
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";
import { playSoundFor, isSoundEnabled } from "@/lib/soundRouter";

// -------------------- Helpers --------------------

// Normalize to second precision (for notif watermark + small keys)
const isoSec = (d) => {
  try {
    return new Date(d).toISOString().split(".")[0];
  } catch {
    return null;
  }
};

// Normalize to local "YYYY-MM-DD" for per-day dedupe on rental toasts
const isoDay = (d) => {
  try {
    const dt = new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return null;
  }
};

// Whole-day difference (end - start) using local midnight boundaries
const daysBetween = (fromDate, toDate) => {
  const a = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate()
  );
  const b = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
};

// "21 Aug 2024"
const fmtShort = (dateLike) => {
  try {
    const d = new Date(dateLike);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(dateLike ?? "");
  }
};

// ✅ Click guard: ignore clicks on the toast close button (or any button)
const shouldIgnoreToastClick = (evt) => {
  try {
    const el = evt?.target;
    if (!el) return false;
    // If the click started on a button (ToastClose is a button), ignore it
    if (typeof el.closest === "function" && el.closest("button")) return true;
    return false;
  } catch {
    return false;
  }
};

// -------------------- Storage Keys --------------------
const STORAGE_LAST_SEEN = "adminGlobalToasts.lastSeenISO";
const STORAGE_SEEN_SET = "adminGlobalToasts.seenTimestamps"; // JSON array of isoSec strings
const STORAGE_LAST_COUNT = "notificationsLastCount"; // broadcast to passive listeners
const STORAGE_RENTAL_SEEN = "adminGlobalToasts.rentalSeenByDay"; // JSON: { "<vehicleId>": "YYYY-MM-DD" }

// -------------------- Component --------------------
export default function AdminGlobalToasts({ loggedInUser }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const roles = Array.isArray(loggedInUser?.roles) ? loggedInUser.roles : [];
  const rolesLower = roles.map((r) => String(r || "").toLowerCase()).filter(Boolean);

  const isAdmin = rolesLower.includes("admin");
  const isDriver = rolesLower.includes("driver");
  const isLimitedDriver = rolesLower.includes("driver_limited");

  // admins + drivers should receive fleet notifications via /notifications polling
  const canPollNotifications = isAdmin || isDriver || isLimitedDriver;

  const canSeeRentalToasts = canPollNotifications;

  // ============================================================
  // A) Notifications poller (admin + drivers for Fleet)
  //    - Password reset → User Management
  //    - Suggestions → Notifications > History (scroll)
  //    - Fleet → Fleet page
  // ============================================================
  useEffect(() => {
    if (!canPollNotifications) return;

    // 🚦 Singleton guard to prevent multiple intervals across the app
    if (window.__loBoardNotificationsPoller) return;

    const controller = new AbortController();

    // Initialize lastSeen watermark
    const lastSeenRef = {
      value: isoSec(localStorage.getItem(STORAGE_LAST_SEEN)) || isoSec(new Date(0)),
    };

    // Initialize played/seen set from storage
    const seenSet = new Set();
    try {
      const raw = localStorage.getItem(STORAGE_SEEN_SET);
      const arr = JSON.parse(raw || "[]");
      if (Array.isArray(arr)) arr.forEach((t) => seenSet.add(String(t)));
    } catch {
      // ignore
    }

    const persistSeen = () => {
      const arr = Array.from(seenSet).sort().slice(-200);
      localStorage.setItem(STORAGE_SEEN_SET, JSON.stringify(arr));
    };

    const advanceWatermark = (items) => {
      const newest = items
        .map((n) => isoSec(n?.timestamp || n?.createdAt || n?.date))
        .filter(Boolean)
        .sort()
        .pop();
      if (newest) {
        lastSeenRef.value = newest;
        localStorage.setItem(STORAGE_LAST_SEEN, newest);
      }
    };

    const goToUserManagement = (n) => {
      const userId = n?.action?.userId;
      const userName = n?.action?.userName;

      if (userId) {
        navigate(
          `/admin?tab=user-management&highlight=${encodeURIComponent(
            String(userId)
          )}`
        );
      } else if (userName) {
        navigate(
          `/admin?tab=user-management&highlightName=${encodeURIComponent(
            String(userName)
          )}`
        );
      } else if (n?.action?.url) {
        navigate(n.action.url);
      } else {
        navigate(`/admin?tab=user-management`);
      }
    };

    async function poll() {
      // 💤 Skip when tab is hidden to reduce network/battery
      if (document.hidden) return;

      try {
        const afterISO = lastSeenRef.value || isoSec(new Date(0));
        const res = await fetch(
          `${API_BASE}/notifications?after=${encodeURIComponent(afterISO)}`,
          { signal: controller.signal }
        );
        if (!res.ok) return;

        const data = await res.json().catch(() => []);
        const items = Array.isArray(data) ? data : [];
        if (items.length === 0) return;

        // Advance watermark regardless (prevents re-fetch loops)
        advanceWatermark(items);

        /* ===========================
           🧭 Toast routing rules start
           - Password reset → User Management (highlight)
           - Suggestion-related → Admin > Notifications > History and scroll to Suggestions
           - Fleet → Fleet page
           =========================== */

        const isSuggestionNotif = (n) => {
          const kind = String(n?.kind || "").toLowerCase();
          const cat = String(n?.category || n?.type || "").toLowerCase();
          return kind.includes("suggestion") || cat === "suggestion" || cat === "suggestions";
        };

        const isFleetNotif = (n) => {
          const kind = String(n?.kind || "").toLowerCase();
          const cat = String(n?.category || n?.type || "").toLowerCase();
          return kind.includes("fleet") || cat === "fleet";
        };

        // recipients matching (supports: name, id, roles, role buckets)
        const isRelevantForMe = (n) => {
          const recipsLower = Array.isArray(n?.recipients)
            ? n.recipients.map((x) => String(x || "").toLowerCase()).filter(Boolean)
            : [];

          const meId = String(loggedInUser?.id || "").toLowerCase();
          const meName = String(loggedInUser?.name || "").toLowerCase();

          // roles + common bucket aliases
          const roleSignals = new Set([
            ...rolesLower,
            ...rolesLower.map((r) => `${r}s`), // admin -> admins, driver -> drivers
            "admins",
            "drivers",
          ]);

          const hitMe =
            (meId && recipsLower.includes(meId)) ||
            (meName && recipsLower.includes(meName));

          const hitRole = recipsLower.some((r) => roleSignals.has(r));

          return hitMe || hitRole;
        };

        // 🔎 Only surface items we actually want to toast here
        const relevantItems = items.filter((n) => {
          const isReset = n?.kind === "password_reset_request";
          const isSuggestion = isSuggestionNotif(n);
          const fleet = isFleetNotif(n);

          // drivers should primarily see fleet; admins can see all 3
          const allowedByRole =
            (isAdmin && (isReset || isSuggestion || fleet)) ||
            (!isAdmin && fleet);

          return allowedByRole && isRelevantForMe(n);
        });

        /* ===========================
           🧭 Toast routing rules end
           =========================== */

        // ✅ Unseen = not yet played
        const unseen = relevantItems.filter((n) => {
          const t = isoSec(n?.timestamp || n?.createdAt || n?.date);
          return t && !seenSet.has(t);
        });

        for (const n of unseen) {
          const suggestion = isSuggestionNotif(n);
          const fleet = isFleetNotif(n);

          const title =
            n?.title ||
            (suggestion
              ? "💡 New Suggestion Received"
              : fleet
              ? "🚚 Fleet update"
              : "🔑 Password Reset Request");

          const message =
            n?.message ||
            (suggestion
              ? "A user submitted a new suggestion."
              : fleet
              ? "A fleet update was posted."
              : "A user requested a password reset.");

          // 🔊 sound (best effort) — keep current behavior
          try {
            const enabled = localStorage.getItem("notificationSoundsEnabled");
            if (enabled !== "false") {
              const a = new Audio("/sounds/lo_notify_new.mp3");
              a.volume = 1;
              const p = a.play();
              if (p && typeof p.catch === "function") {
                p.catch((e) => console.warn("[sound] play blocked:", e));
              }
            }
          } catch (e) {
            console.warn("[sound] play failed:", e);
          }

          toast({
            title,
            description: message,
            duration: 7000,
            className: "cursor-pointer",
            onClick: (evt) => {
              if (shouldIgnoreToastClick(evt)) return;

              if (suggestion) {
                navigate(`/admin?tab=notifications&subtab=history&scroll=suggestions`);
                return;
              }

              if (fleet) {
                navigate("/fleet");
                return;
              }

              goToUserManagement(n);
            },
          });

          // mark as played so it never replays
          const t = isoSec(n?.timestamp || n?.createdAt || n?.date);
          if (t) {
            seenSet.add(t);
            persistSeen();
          }
        }

        // 📣 Broadcast to passive listeners (Navbar/MyProfile etc.)
        localStorage.setItem(STORAGE_LAST_COUNT, String(items.length));
        window.dispatchEvent(new CustomEvent("notifications:new", { detail: items }));
      } catch (e) {
        if (e?.name !== "AbortError") {
          console.warn("[AdminGlobalToasts] poll error:", e);
        }
      }
    }

    // Kick off now, then every 30s
    poll();
    const id = setInterval(poll, 30000);

    // Expose singleton so other mounts don't double-poll
    window.__loBoardNotificationsPoller = { id, controller };

    // Cleanup only if this instance created the singleton
    return () => {
      if (window.__loBoardNotificationsPoller?.id === id) {
        clearInterval(id);
        controller.abort();
        window.__loBoardNotificationsPoller = null;
      }
    };
  }, [
    canPollNotifications,
    isAdmin,
    loggedInUser?.id,
    loggedInUser?.name,
    navigate,
    toast,
    rolesLower.join("|"),
  ]);

  // ============================================================
  // B) Rental ending toasts on login (admins & drivers)
  //    - Click toast → /fleet
  //    - FIX: prevent double-sound (remove manual Audio play)
  // ============================================================
  useEffect(() => {
    if (!canSeeRentalToasts) return;

    let abort = false;

    const readJson = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    };
    const writeJson = (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* ignore */
      }
    };

    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/vehicles`);
        if (!res.ok) return;
        const vehicles = await res.json();
        if (abort || !Array.isArray(vehicles)) return;

        const today = new Date();
        const seen = readJson(STORAGE_RENTAL_SEEN, {}); // { [vehicleId]: "YYYY-MM-DD" }
        const todayKey = isoDay(today);

        const isRental = (v) =>
          v?.status === "Rental" ||
          v?.type === "Rental" ||
          v?.permanent === false ||
          (v?.rentStartISO && v?.rentEndISO);

        vehicles.filter(isRental).forEach((v) => {
          const endISO = v?.rentEndISO;
          if (!endISO) return;

          const end = new Date(endISO);
          const diff = daysBetween(today, end); // 1 = tomorrow, 0 = today, -1 = yesterday

          if (![-1, 0, 1].includes(diff)) return; // only nudge around the end date
          if (seen[v.id] === todayKey) return; // de-dupe per day

          const startLabel = v?.rentStartISO ? fmtShort(v.rentStartISO) : "Unknown";
          const endLabel = fmtShort(endISO);
          const plate = v?.licensePlate || v?.plate || v?.name || "Vehicle";

          const title =
            diff === 1
              ? "Rental ends tomorrow"
              : diff === 0
              ? "Rental ends today"
              : "Rental expired yesterday";

          const description = `${plate} • ${startLabel} → ${endLabel}`;

          toast({
            title,
            description,
            className: "cursor-pointer",
            onClick: (evt) => {
              if (shouldIgnoreToastClick(evt)) return;
              navigate("/fleet");
            },
          });

          // ✅ Single sound path (no double play)
          if (isSoundEnabled()) {
            playSoundFor({ title, message: description }, { enabled: true });
          }

          // mark seen for today
          seen[v.id] = todayKey;
        });

        writeJson(STORAGE_RENTAL_SEEN, seen);
      } catch {
        // silent fail; just skip toasts
      }
    };

    // Fire once on login/mount (exactly when users notice it)
    run();

    return () => {
      abort = true;
    };
  }, [canSeeRentalToasts, navigate, toast]);

  return null;
}


