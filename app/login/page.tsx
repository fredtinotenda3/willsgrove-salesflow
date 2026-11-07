"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Leaf, Loader2 } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.message ?? "Unable to sign in.");
        setSubmitting(false);
        return;
      }

      const destination = data.user?.mustChangePassword
        ? "/change-password"
        : next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/";

      router.replace(destination);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f8f6] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#10271F] text-[#D7F36B]">
            <Leaf size={26} strokeWidth={2.5} />
          </div>
          <div className="text-center">
            <h1 className="text-lg font-bold tracking-tight text-[#10271F]">Willsgrove SalesFlow</h1>
            <p className="text-xs text-[#10271F]/60">Sign in to continue</p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-black/5 bg-white p-6 shadow-sm"
          noValidate
        >
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-[#10271F]/80">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#10271F] outline-none focus:border-[#10271F]/40 focus:ring-2 focus:ring-[#10271F]/10"
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-[#10271F]/80">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm text-[#10271F] outline-none focus:border-[#10271F]/40 focus:ring-2 focus:ring-[#10271F]/10"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#10271F] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#10271F]/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
