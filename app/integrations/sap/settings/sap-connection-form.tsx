"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { SapConnectionSummary } from "@/lib/integrations/sap/connection";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function SapConnectionForm({ initialConnection }: { initialConnection: SapConnectionSummary }) {
  const router = useRouter();
  const [mode, setMode] = useState<"MOCK" | "LIVE">(initialConnection.mode);
  const [enabled, setEnabled] = useState(initialConnection.enabled);
  const [baseUrl, setBaseUrl] = useState(initialConnection.baseUrl ?? "");
  const [companyDb, setCompanyDb] = useState(initialConnection.companyDb ?? "");
  const [username, setUsername] = useState(initialConnection.username ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/sap/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          enabled,
          baseUrl: baseUrl.trim() === "" ? null : baseUrl.trim(),
          companyDb: companyDb.trim() === "" ? null : companyDb.trim(),
          username: username.trim() === "" ? null : username.trim(),
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to save these settings.");
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/integrations/sap/connection/test", { method: "POST" });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to test the connection.");
        return;
      }
      const health = data.health as { ok: boolean; message: string };
      setTestResult({ ok: health.ok, message: health.message });
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
      <h2 className="text-sm font-bold text-[#17251E]">SAP Business One connection</h2>
      <p className="mt-1 text-xs text-gray-500">
        Live mode only actually contacts SAP once this is enabled, set to Live, has a base URL/company DB/username below, AND the server&apos;s
        SAP_B1_PROVIDER environment variable also says &quot;live&quot;.
      </p>

      <div className="mt-4 grid max-w-xl gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Integration enabled
        </label>

        <label className="text-xs font-medium text-gray-600">
          Mode
          <select value={mode} onChange={(e) => setMode(e.target.value as "MOCK" | "LIVE")} className="mt-1 block w-48 rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
            <option value="MOCK">Mock (synthetic test data)</option>
            <option value="LIVE">Live</option>
          </select>
        </label>

        <label className="text-xs font-medium text-gray-600">
          Service Layer base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-sap-server:50000/b1s/v1"
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
          />
        </label>

        <label className="text-xs font-medium text-gray-600">
          Company database
          <input value={companyDb} onChange={(e) => setCompanyDb(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>

        <label className="text-xs font-medium text-gray-600">
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
        </label>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {testResult && (
        <p className={`mt-3 text-xs ${testResult.ok ? "text-emerald-700" : "text-red-600"}`}>{testResult.ok ? "✓ " : "✗ "}{testResult.message}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
        <button onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {testing && <Loader2 size={12} className="animate-spin" />}
          Test connection
        </button>
      </div>

      {initialConnection.lastTestedAt && (
        <p className="mt-3 text-[11px] text-gray-400">
          Last tested {new Date(initialConnection.lastTestedAt).toLocaleString()} -- {initialConnection.lastTestOk ? "succeeded" : "failed"}
          {initialConnection.lastTestMessage ? `: ${initialConnection.lastTestMessage}` : ""}
        </p>
      )}
    </div>
  );
}
