import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLAIM_STATUS_LABELS } from "@/lib/invoice-claims/display";
import { RETURN_FACET_LABELS } from "@/lib/invoice-claims/invoice-claim-state";
import type { ReturnedProductRow } from "@/lib/invoice-claims/returned-products";

/**
 * Register of products customers returned (part or all of a line) for a
 * standardised delivery-outcome reason, with the claim raised against
 * them. Quantities and values are claim EXPOSURE, not confirmed loss
 * (that stays the returned-product valuation's job). Presentational
 * Server Component; the page supplies rows and filter links.
 */
export default function InvoiceRegister({
  rows,
  total,
  filterHref,
  activeFilter,
}: {
  rows: ReturnedProductRow[];
  total: number;
  filterHref: (claim: "all" | "none" | "with") => string;
  activeFilter: "all" | "none" | "with";
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EBE6] px-6 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#17251E]">Returned products ({total})</h2>
          <p className="text-xs text-gray-400">
            Invoices and orders where some or all of a product was returned, with the reason recorded at delivery. Values are claim exposure, not confirmed loss.
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "none", "with"] as const).map((key) => (
            <Button key={key} asChild size="xs" variant={activeFilter === key ? "default" : "outline"}>
              <Link href={filterHref(key)}>{key === "all" ? "All" : key === "with" ? "Claim filed" : "Awaiting claim"}</Link>
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-xs text-gray-400">No returned products match this filter.</p>
      ) : (
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="px-4">Invoice / order</TableHead>
              <TableHead className="px-4">Customer</TableHead>
              <TableHead className="px-4">Product</TableHead>
              <TableHead className="px-4 text-right">Delivered</TableHead>
              <TableHead className="px-4 text-right">Accepted</TableHead>
              <TableHead className="px-4 text-right">Returned / rejected</TableHead>
              <TableHead className="px-4">Reason</TableHead>
              <TableHead className="px-4 text-right">Value</TableHead>
              <TableHead className="px-4">Claim</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const claimParams = new URLSearchParams({ orderId: row.orderId, orderLineId: row.orderLineId, rejectedQuantity: row.rejectedQuantity });
              if (row.reasonLabel) claimParams.set("reasonLabel", row.reasonLabel);
              return (
                <TableRow key={row.key}>
                  <TableCell className="px-4 align-top whitespace-normal">
                    <p className="font-semibold text-[#17251E]">{row.invoiceReference ?? "No invoice yet"}</p>
                    <Link href={`/orders/${row.orderId}`} className="text-[10px] font-semibold text-[#173D2E] hover:underline">
                      {row.orderReference}
                    </Link>
                    <p className="text-[10px] text-gray-400">{new Date(row.deliveredAt).toLocaleDateString()}</p>
                  </TableCell>
                  <TableCell className="px-4 align-top whitespace-normal font-medium text-gray-700">{row.customerName}</TableCell>
                  <TableCell className="px-4 align-top whitespace-normal">
                    {row.description}
                    {row.sapItemCode && <span className="ml-1.5 text-[10px] text-gray-400">({row.sapItemCode})</span>}
                  </TableCell>
                  <TableCell className="px-4 text-right align-top tabular-nums">{row.deliveredQuantity}</TableCell>
                  <TableCell className="px-4 text-right align-top tabular-nums">{row.acceptedQuantity}</TableCell>
                  <TableCell className="px-4 text-right align-top tabular-nums">
                    <span className="font-semibold text-amber-700">{row.rejectedQuantity}</span>
                    <p className="text-[10px] text-gray-400">
                      returned {row.returnedQuantity}
                      {row.returnFacet !== "NONE" ? ` · ${RETURN_FACET_LABELS[row.returnFacet]}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="px-4 align-top whitespace-normal">
                    {row.reasonLabel ? <Badge variant="outline">{row.reasonLabel}</Badge> : <span className="text-gray-400">Not recorded</span>}
                  </TableCell>
                  <TableCell className="px-4 text-right align-top tabular-nums">
                    {row.rejectedValue !== null ? `${row.rejectedValue} ${row.currencyCode}` : <span className="text-gray-300">--</span>}
                  </TableCell>
                  <TableCell className="px-4 align-top whitespace-normal">
                    {row.claims.length === 0 ? (
                      <Button asChild size="xs" variant="outline">
                        <Link href={`/invoice-claims/new?${claimParams.toString()}`}>File a claim</Link>
                      </Button>
                    ) : (
                      <ul className="space-y-1">
                        {row.claims.map((claim) => (
                          <li key={claim.id}>
                            <Link href={`/invoice-claims/${claim.id}`} className="font-semibold text-[#173D2E] hover:underline">
                              {claim.claimReference}
                            </Link>{" "}
                            <span className="text-gray-400">{CLAIM_STATUS_LABELS[claim.status] ?? claim.status}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
