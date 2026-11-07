"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2 } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [forced, setForced] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.user) {
          router.replace("/login");
          return;
        }
        setForced(Boolean(data.user.mustChangePassword));
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message ?? "Could not change your password.");
        setSubmitting(false);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (checking) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#10271F] text-[#D7F36B]">
            <KeyRound size={24} strokeWidth={2.5} />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold tracking-tight text-[#10271F]">
              {forced ? "Set a new password" : "Change your password"}
            </h1>
            {forced && (
              <p className="mt-1 text-xs text-[#10271F]/60">
                This account was created with a temporary password. Choose a new one to continue.
              </p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm" noValidate>
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="currentPassword" className="mb-1.5 block text-xs font-semibold text-[#10271F]/80">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#10271F] outline-none focus:border-[#10271F]/40 focus:ring-2 focus:ring-[#10271F]/10"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="newPassword" className="mb-1.5 block text-xs font-semibold text-[#10271F]/80">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#10271F] outline-none focus:border-[#10271F]/40 focus:ring-2 focus:ring-[#10271F]/10"
            />
            <p className="mt-1 text-[11px] text-[#10271F]/50">At least 10 characters.</p>
          </div>

          <div className="mb-6">
            <label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-semibold text-[#10271F]/80">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#10271F] outline-none focus:border-[#10271F]/40 focus:ring-2 focus:ring-[#10271F]/10"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#10271F] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#10271F]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? "Saving…" : "Save password"}
          </button>
        </form>
      </div>
    </div>
  );
}
