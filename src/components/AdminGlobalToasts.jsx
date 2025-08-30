// src/components/AdminGlobalToasts.jsx
// v0.6.4 — Singleton poller (30s), tab-aware pause, password-reset only, broadcasts updates
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";

// Normalize to second precision (to match backend compares, and to keep keys small)
const isoSec = (d) => {
  try {
    return new Date(d).toISOString().split(".")[0];
  } catch {
    return null;
  }
};

const STORAGE_LAST_SEEN = "adminGlobalToasts.lastSeenISO";
const STORAGE_SEEN_SET = "adminGlobalToasts.seenTimestamps"; // JSON array of isoSec strings
const STORAGE_LAST_COUNT = "notificationsLastCount"; // broadcast to passive listeners

export default function AdminGlobalToasts({ loggedInUser }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isAdmin =
    Array.isArray(loggedInUser?.roles) && loggedInUser.roles.includes("admin");

  useEffect(() => {
    if (!isAdmin) return;

    // 🚦 Singleton guard to prevent multiple intervals across the app
    if (window.__loBoardNotificationsPoller) return;

    const controller = new AbortController();

    // Initialize lastSeen watermark
    const lastSeenRef = {
      value:
        isoSec(localStorage.getItem(STORAGE_LAST_SEEN)) ||
        isoSec(new Date(0)),
    };

    // Initialize seen set from storage
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
          `/admin?tab=user-management&highlight=${encodeURIComponent(String(userId))}`
        );
      } else if (userName) {
        navigate(
          `/admin?tab=user-management&highlightName=${encodeURIComponent(String(userName))}`
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

        // Mark everything we fetched as "seen-able" and advance the watermark
        for (const n of items) {
          const t = isoSec(n?.timestamp || n?.createdAt || n?.date);
          if (t) seenSet.add(t);
        }
        persistSeen();
        advanceWatermark(items);

        // 🔎 Only surface admin-relevant password reset requests
        const adminItems = items.filter((n) => {
          const recips = Array.isArray(n?.recipients)
            ? n.recipients.map((x) => String(x).toLowerCase())
            : [];
          const relevant =
            recips.includes("admin") ||
            recips.includes("admins") ||
            recips.includes(String(loggedInUser?.id || "").toLowerCase()) ||
            recips.includes(String(loggedInUser?.name || "").toLowerCase());
          return relevant && n?.kind === "password_reset_request";
        });

        // 🚫 Deduplicate by timestamp at second resolution
        const unseen = adminItems.filter((n) => {
          const t = isoSec(n?.timestamp || n?.createdAt || n?.date);
          return t && !seenSet.has(t);
        });

        for (const n of unseen) {
          const title = n?.title || "🔑 Password Reset Request";
          const message = n?.message || "A user requested a password reset.";
          toast({ title, description: message, duration: 6000 });

          const who = n?.action?.userName || "this user";
          const ok = window.confirm(
            `Open User Management to handle ${who} now?`
          );
          if (ok) goToUserManagement(n);

          // mark as seen so it never replays
          const t = isoSec(n?.timestamp || n?.createdAt || n?.date);
          if (t) {
            seenSet.add(t);
            persistSeen();
          }
        }

        // 📣 Broadcast to passive listeners (Navbar/MyProfile etc.)
        localStorage.setItem(STORAGE_LAST_COUNT, String(items.length));
        window.dispatchEvent(
          new CustomEvent("notifications:new", { detail: items })
        );
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
  }, [isAdmin, loggedInUser?.id, loggedInUser?.name, navigate, toast]);

  return null;
}
