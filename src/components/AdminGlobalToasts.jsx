// src/components/AdminGlobalToasts.jsx
// v0.6.3 — Global admin toasts: debounced, deduped, password-reset only, reliable redirect
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";

// Normalize to second precision (matches backend compare)
const isoSec = (d) => {
  try {
    return new Date(d).toISOString().split(".")[0];
  } catch {
    return null;
  }
};

const STORAGE_LAST_SEEN = "adminGlobalToasts.lastSeenISO";
const STORAGE_SEEN_SET = "adminGlobalToasts.seenTimestamps"; // JSON array of isoSec strings

export default function AdminGlobalToasts({ loggedInUser }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  const isAdmin =
    Array.isArray(loggedInUser?.roles) && loggedInUser.roles.includes("admin");

  // lastSeen watermark (isoSec string)
  const lastSeenRef = useRef(
    isoSec(localStorage.getItem(STORAGE_LAST_SEEN) || new Date(Date.now() - 5000))
  );

  // seen cache to prevent repeats; initialize once from localStorage (NO function call on the ref!)
  const seenRef = useRef(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SEEN_SET);
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        seenRef.current = new Set(arr);
      }
    } catch {
      // ignore
    }
  }, []);

  const tickingRef = useRef(false);

  const markSeenAndAdvance = (items) => {
    if (!items?.length) return;

    // update seen set
    const copy = new Set(seenRef.current);
    for (const n of items) {
      const t = isoSec(n?.timestamp);
      if (t) copy.add(t);
    }
    // cap the set to last 200
    const arr = Array.from(copy).sort().slice(-200);
    seenRef.current = new Set(arr);
    localStorage.setItem(STORAGE_SEEN_SET, JSON.stringify(arr));

    // advance lastSeen to newest timestamp across ALL fetched items
    const newest = items
      .map((n) => isoSec(n?.timestamp))
      .filter(Boolean)
      .sort()
      .pop();
    if (newest) {
      lastSeenRef.current = newest;
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

  useEffect(() => {
    if (!isAdmin) return;

    // poll every 30s to reduce noise
    const interval = setInterval(async () => {
      if (tickingRef.current) return;
      tickingRef.current = true;

      try {
        const afterISO =
          lastSeenRef.current || isoSec(new Date(Date.now() - 5000));
        const res = await fetch(
          `${API_BASE}/notifications?after=${encodeURIComponent(afterISO)}`
        );
        const data = await res.json().catch(() => []);
        const items = Array.isArray(data) ? data : [];

        if (items.length === 0) return;

        // Always advance watermark & mark seen for everything we fetched
        markSeenAndAdvance(items);

        // Only surface password reset requests to avoid spam
        const adminItems = items.filter((n) => {
          const list = (n?.recipients || []).map((x) =>
            String(x).toLowerCase()
          );
          const relevantToAdmin =
            list.includes("admin") ||
            list.includes("admins") ||
            list.includes(String(loggedInUser?.id || "").toLowerCase()) ||
            list.includes(String(loggedInUser?.name || "").toLowerCase());
          return relevantToAdmin && n?.kind === "password_reset_request";
        });

        // Deduplicate using seen set at isoSec level; only toast unseen
        const unseen = adminItems.filter((n) => {
          const t = isoSec(n?.timestamp);
          return t && !seenRef.current.has(t);
        });

        for (const n of unseen) {
          const title = n?.title || "🔑 Password Reset Request";
          const message = n?.message || "A user requested a password reset.";

          // Plain toast + native confirm for redirect
          toast({ title, description: message, duration: 6000 });

          const who = n?.action?.userName || "this user";
          const ok = window.confirm(
            `Open User Management to handle ${who} now?`
          );
          if (ok) goToUserManagement(n);

          // mark individual as seen so it never replays
          const t = isoSec(n?.timestamp);
          if (t) {
            const next = new Set(seenRef.current);
            next.add(t);
            const arr = Array.from(next).sort().slice(-200);
            seenRef.current = new Set(arr);
            localStorage.setItem(STORAGE_SEEN_SET, JSON.stringify(arr));
          }
        }
      } catch {
        // silent
      } finally {
        tickingRef.current = false;
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isAdmin, loggedInUser?.id, loggedInUser?.name, navigate, toast]);

  return null;
}
