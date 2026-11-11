"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";

/**
 * Milestone 8. The internal notification mechanism's one visible surface
 * (spec section 2: "no mechanism currently exists to notify relevant
 * users... implement an internal in-app notification"). Polls its own
 * unread count on a plain interval rather than a push channel -- no
 * websocket/SSE infrastructure exists anywhere else in this project, and
 * introducing one for a single bell icon would be a disproportionate
 * amount of new infrastructure for this milestone's scope.
 */

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

const POLL_INTERVAL_MS = 30000;

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    function pollUnreadCount() {
      fetch("/api/notifications?take=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled && typeof data.unreadCount === "number") {
            setUnreadCount(data.unreadCount);
          }
        })
        .catch(() => {
          // The bell simply shows a stale/zero count until the next poll
          // succeeds -- no further auth/route enforcement happens here.
        });
    }

    pollUnreadCount();
    const interval = setInterval(pollUnreadCount, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function loadNotifications() {
    setLoading(true);
    fetch("/api/notifications?take=15", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.notifications)) setNotifications(data.notifications);
        if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) loadNotifications();
  }

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    } catch {
      // Best-effort -- a failed mark-as-read just means it shows unread
      // again next time the list is reloaded; it is not worth surfacing
      // an error for.
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    } catch {
      // Best-effort, same as markRead above.
    }
  }

  // No effect needed to close the dropdown on navigation: Sidebar (and
  // this bell with it) is instantiated fresh per page rather than held
  // in a shared layout, so a route change already remounts it with
  // `open` back at its initial `false`.

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggleOpen}
        aria-label="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/[0.07] hover:text-white"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D7F36B] px-1 text-[9px] font-bold text-[#10271F]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-[52px] left-0 z-20 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#152E24] text-left shadow-lg">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-xs font-semibold text-white">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] font-semibold text-white/50 hover:text-white">
                <CheckCheck size={12} />
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-center text-[11px] text-white/40">Loading…</p>}
            {!loading && notifications.length === 0 && <p className="px-4 py-6 text-center text-[11px] text-white/40">No notifications yet.</p>}
            {!loading &&
              notifications.map((notification) => {
                const unread = notification.readAt === null;
                const content = (
                  <div className={`border-b border-white/5 px-4 py-3 text-xs transition hover:bg-white/[0.05] ${unread ? "bg-white/[0.03]" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className={`font-semibold ${unread ? "text-white" : "text-white/60"}`}>{notification.title}</p>
                      {unread && <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#D7F36B]" />}
                    </div>
                    <p className="mt-0.5 text-white/50">{notification.message}</p>
                    <p className="mt-1 text-[10px] text-white/30">{new Date(notification.createdAt).toLocaleString()}</p>
                  </div>
                );
                return notification.link ? (
                  <Link key={notification.id} href={notification.link} onClick={() => unread && markRead(notification.id)}>
                    {content}
                  </Link>
                ) : (
                  <button key={notification.id} onClick={() => unread && markRead(notification.id)} className="block w-full text-left">
                    {content}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
