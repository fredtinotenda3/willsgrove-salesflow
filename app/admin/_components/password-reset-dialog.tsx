"use client";

import { useState } from "react";
import { ActionDialog } from "./action-dialog";

/** Reset (shows the new temporary password once) or require a change at next sign-in. */
export function PasswordResetDialog({ userId }: { userId: string }) {
  const [temp, setTemp] = useState<string | null>(null);
  return (
    <>
      <ActionDialog label="Reset password" title="Reset password" description="Generates a new temporary password, signs the user out and forces a change at next sign-in. You will see it once." endpoint={`/api/admin/users/${userId}/password`} payload={{ action: "reset" }} confirmLabel="Reset" onDone={(d) => setTemp(typeof d.temporaryPassword === "string" ? d.temporaryPassword : null)} />
      <ActionDialog label="Require password change" title="Require password change" description="The user is signed out and must choose a new password at next sign-in." endpoint={`/api/admin/users/${userId}/password`} payload={{ action: "require-change" }} confirmLabel="Require change" />
      {temp ? (
        <div role="dialog" aria-modal="true" aria-label="Temporary password" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="font-bold">Temporary password</h3>
            <p className="text-sm">Share it through a secure channel. It is not stored and will not be shown again.</p>
            <code className="block select-all rounded-lg bg-[#F1F4F0] p-3 text-sm">{temp}</code>
            <button type="button" onClick={() => { setTemp(null); location.reload(); }} className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Done</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
