"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import Sidebar from "../../components/sidebar";

type DuplicateGroup = { description: string; codes: string[] };
type NonBarcodeValue = { sapItemCode: string; itemName: string; rawValue: string };
type LeadingZeroCode = { sapItemCode: string; itemName: string };
type BlankDescription = { sapItemCode: string; category: string | null };

type Report = {
  generatedAt: string;
  totalProducts: number;
  summary: {
    blankDescriptions: number;
    duplicateDescriptionGroups: number;
    duplicateDescriptionRows: number;
    nonBarcodeValues: number;
    leadingZeroCodes: number;
    itemsWithoutUnit: number;
    itemsWithoutVatCode: number;
  };
  blankDescriptions: BlankDescription[];
  duplicateDescriptions: DuplicateGroup[];
  nonBarcodeValues: NonBarcodeValue[];
  leadingZeroCodes: LeadingZeroCode[];
  sampleLimit: number;
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export default function CatalogueHealthPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/catalogue/health", { cache: "no-store" });
      const body = await response.json();
      if (response.ok && body?.success) {
        setReport(body as Report);
      } else {
        setError(body?.message ?? "Unable to load the catalogue health report.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Deferred to a microtask rather than called directly in the effect
    // body, matching the pattern already used in app/orders/page.tsx --
    // load()'s first line is a synchronous setLoading/setError, and
    // calling that straight from the effect body trips
    // react-hooks/set-state-in-effect (cascading-render risk).
    void Promise.resolve().then(() => load());
  }, []);

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / SAP master data / Catalogue health</p>
            <h1 className="mt-1 text-lg font-semibold">Catalogue health report</h1>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5EAE4] bg-white px-3 py-2 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link href="/products" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to products
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Catalogue health</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              A live check of your real SAP product catalogue: duplicate and blank descriptions, non-barcode
              values that slipped into the BARCODE column, codes at risk of losing a leading zero, and how
              much of the item-master extension (unit, VAT code) is still missing.
            </p>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {loading && !report && <p className="text-sm text-[#7D8981]">Loading…</p>}

          {report && (
            <>
              <p className="mb-4 text-xs text-[#89948D]">
                {formatNumber(report.totalProducts)} products checked · generated{" "}
                {new Date(report.generatedAt).toLocaleString()}
              </p>

              <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <SummaryCard label="Blank descriptions" value={report.summary.blankDescriptions} />
                <SummaryCard
                  label="Duplicate descriptions"
                  value={report.summary.duplicateDescriptionGroups}
                  sub={`${formatNumber(report.summary.duplicateDescriptionRows)} rows affected`}
                />
                <SummaryCard label="Non-barcode BARCODE values" value={report.summary.nonBarcodeValues} />
                <SummaryCard label="Leading-zero codes" value={report.summary.leadingZeroCodes} />
                <SummaryCard label="Items without a unit" value={report.summary.itemsWithoutUnit} />
                <SummaryCard label="Items without a VAT code" value={report.summary.itemsWithoutVatCode} />
              </section>

              {report.duplicateDescriptions.length > 0 && (
                <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <h3 className="text-base font-semibold">Duplicate descriptions</h3>
                  <p className="mt-1 text-sm text-[#7D8981]">
                    More than one SAP code shares the same description -- confirm these are genuinely
                    different items (e.g. different pack sizes) before relying on description alone.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead className="text-xs text-[#89948D]">
                        <tr>
                          <th className="py-2 pr-4 font-medium">Description</th>
                          <th className="py-2 pr-4 font-medium">Count</th>
                          <th className="py-2 font-medium">Codes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.duplicateDescriptions.slice(0, 20).map((group) => (
                          <tr key={group.description} className="border-t border-[#EEF1ED]">
                            <td className="py-2 pr-4">{group.description}</td>
                            <td className="py-2 pr-4">{group.codes.length}</td>
                            <td className="py-2 font-mono text-xs">{group.codes.join(", ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.duplicateDescriptions.length > 20 && (
                    <p className="mt-3 text-xs text-[#89948D]">
                      Showing 20 of {formatNumber(report.duplicateDescriptions.length)} duplicate groups.
                    </p>
                  )}
                </section>
              )}

              {report.nonBarcodeValues.length > 0 && (
                <section className="mt-6 rounded-2xl border border-[#F0E3C2] bg-[#FFFAEE] p-6">
                  <h3 className="text-base font-semibold text-[#8A6212]">Non-barcode values in BARCODE</h3>
                  <p className="mt-1 text-sm text-[#8A6212]">
                    Already excluded from the barcode field (never saved as a fake barcode) -- the original
                    text is kept here for reference, e.g. item 8028&apos;s BARCODE of &quot;Deli&quot;.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead className="text-xs text-[#8A6212]">
                        <tr>
                          <th className="py-2 pr-4 font-medium">Code</th>
                          <th className="py-2 pr-4 font-medium">Description</th>
                          <th className="py-2 font-medium">Original BARCODE value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.nonBarcodeValues.slice(0, 20).map((v) => (
                          <tr key={v.sapItemCode} className="border-t border-[#F0E3C2]">
                            <td className="py-2 pr-4 font-mono text-xs">{v.sapItemCode}</td>
                            <td className="py-2 pr-4">{v.itemName}</td>
                            <td className="py-2 font-mono text-xs">{v.rawValue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.nonBarcodeValues.length > 20 && (
                    <p className="mt-3 text-xs text-[#8A6212]">
                      Showing 20 of {formatNumber(report.nonBarcodeValues.length)}.
                    </p>
                  )}
                </section>
              )}

              {report.blankDescriptions.length > 0 && (
                <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <h3 className="text-base font-semibold">Blank descriptions</h3>
                  <p className="mt-4 font-mono text-xs text-[#5E7366]">
                    {report.blankDescriptions.map((d) => d.sapItemCode).join(", ")}
                  </p>
                </section>
              )}

              {report.leadingZeroCodes.length > 0 && (
                <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <h3 className="text-base font-semibold">
                    Codes at risk of losing a leading zero ({formatNumber(report.summary.leadingZeroCodes)})
                  </h3>
                  <p className="mt-1 text-sm text-[#7D8981]">
                    Keep these as text everywhere -- a spreadsheet re-save can silently turn &quot;0228&quot; into
                    228. First 30 shown.
                  </p>
                  <p className="mt-3 font-mono text-xs text-[#5E7366]">
                    {report.leadingZeroCodes.slice(0, 30).map((c) => c.sapItemCode).join(", ")}
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-[#E8ECE7] bg-white px-4 py-3">
      <p className="text-xs text-[#89948D]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{formatNumber(value)}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[#89948D]">{sub}</p>}
    </div>
  );
}
