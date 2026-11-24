"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Creates a user through the existing administrator-only POST /api/users; the one-time temporary password is shown once. */
export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("SALESPERSON");
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setError(data.message ?? "The user was not created."); return; }
      setTemp(data.temporaryPassword ?? null);
      router.refresh();
    } catch { setError("Network error."); } finally { setBusy(false); }
  }
  function close() { setOpen(false); setTemp(null); setName(""); setEmail(""); setError(null); }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Add user</button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Add user" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold">Add user</h3>
            {temp ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm">User created. Give them this temporary password through a secure channel. It is shown only once and must be changed at first sign-in.</p>
                <code className="block rounded-lg bg-[#F1F4F0] p-3 text-sm select-all">{temp}</code>
                <button type="button" onClick={close} className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Done</button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
                <input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
                <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="SALESPERSON">Salesperson</option><option value="SALES_MANAGER">Sales Manager</option><option value="ADMINISTRATOR">Administrator</option></select>
                {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
                <div className="flex justify-end gap-2"><button type="button" onClick={close} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm">Cancel</button><button type="button" disabled={busy || !name.trim() || !email.trim()} onClick={submit} className="rounded-lg bg-[#1F7A4D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Create user"}</button></div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
