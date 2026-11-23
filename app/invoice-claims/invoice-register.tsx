import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CLAIM_STATUS_LABELS } from "@/lib/invoice-claims/display";
import { CLAIM_FACET_LABELS, RETURN_FACET_LABELS } from "@/lib/invoice-claims/invoice-claim-state";
import type { InvoiceRegisterRow } from "@/lib/invoice-claims/invoice-register";

/**
 * Register of every SalesFlow-generated invoice and its claim outcome --
 * including invoices with no claim at all. Presentational Server Component;
 * the page supplies rows and the filter links. Quantities here are claim
 * EXPOSURE (disputed/rejected) and physical returns; neither is a confirmed
 * financial loss (that stays the returned-product valuation's job).
 */
const FACET_VARIANT = { NO_CLAIM: "secondary", CLAIM_RECORDED: "outline", PENDING_RESOLUTION: "default", RESOLVED: "secondary" } as const;

export default function InvoiceRegister({
  rows,
  total,
  filterHref,
  activeFilter,
}: {
  rows: InvoiceRegisterRow[];
  total: number;
  filterHref: (claim: "all" | "none" | "with") => string;
  activeFilter: "all" | "none" | "with";
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8EBE6] px-6 py-3">
        <div>
          <h2 className="text-sm font-bold text-[#17251E]">Invoice register ({total})</h2>
          <p className="text-xs text-gray-400">
            Every invoice generated in SalesFlow, with or without a claim. Claim quantities are exposure, not confirmed loss.
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "with", "none"] as const).map((key) => (
            <Button key={key} asChild size="xs" variant={activeFilter === key ? "default" : "outline"}>
              <Link href={filterHref(key)}>{key === "all" ? "All" : key === "with" ? "With claim" : "No claim"}</Link>
            </Button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-xs text-gray-400">No SalesFlow invoices match this filter.</p>
      ) : (
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32 px-4">Invoice</TableHead>
              <TableHead className="px-4">Customer / order</TableHead>
              <TableHead className="hidden w-20 px-4 text-right lg:table-cell">Invoiced</TableHead>
              <TableHead className="hidden w-20 px-4 text-right lg:table-cell">Accepted</TableHead>
              <TableHead className="hidden w-20 px-4 text-right lg:table-cell">Rejected</TableHead>
              <TableHead className="hidden w-20 px-4 text-right xl:table-cell">Returned</TableHead>
              <TableHead className="w-44 px-4">Outcome</TableHead>
              <TableHead className="px-4">Claims</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.invoiceId}>
                <TableCell className="px-4 align-top">
                  <p className="font-semibold text-[#17251E]">{row.invoiceReference}</p>
                  <p className="text-[10px] text-gray-400">{row.invoiceDate ? new Date(row.invoiceDate).toLocaleDateString() : "Not Available"}</p>
                </TableCell>
                <TableCell className="px-4 align-top whitespace-normal">
                  <p className="font-medium text-gray-700">{row.customerName ?? "Not Available"}</p>
                  {row.orderId ? (
                    <Link href={`/orders/${row.orderId}`} className="text-[10px] font-semibold text-[#173D2E] hover:underline">
                      {row.orderReference}
                    </Link>
                  ) : (
                    <span className="text-[10px] text-gray-400">No linked order</span>
                  )}
                </TableCell>
                <TableCell className="hidden px-4 text-right align-top tabular-nums lg:table-cell">{row.invoicedQuantity}</TableCell>
                <TableCell className="hidden px-4 text-right align-top tabular-nums lg:table-cell">{row.claims.length ? row.acceptedQuantity : "--"}</TableCell>
                <TableCell className="hidden px-4 text-right align-top tabular-nums lg:table-cell">{row.claims.length ? row.rejectedQuantity : "--"}</TableCell>
                <TableCell className="hidden px-4 text-right align-top tabular-nums xl:table-cell">{row.claims.length ? row.returnedQuantity : "--"}</TableCell>
                <TableCell className="px-4 align-top whitespace-normal">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={FACET_VARIANT[row.claimFacet]}>{CLAIM_FACET_LABELS[row.claimFacet]}</Badge>
                    {row.returnFacet !== "NONE" && <Badge variant="outline">{RETURN_FACET_LABELS[row.returnFacet]}</Badge>}
                  </div>
                </TableCell>
                <TableCell className="px-4 align-top whitespace-normal">
                  {row.claims.length === 0 ? (
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/invoice-claims/new${row.orderId ? `?orderId=${row.orderId}` : ""}`}>File a claim</Link>
                    </Button>
                  ) : (
                    <ul className="space-y-1">
                      {row.claims.map((claim) => (
                        <li key={claim.id}>
                          <Link href={`/invoice-claims/${claim.id}`} className="font-semibold text-[#173D2E] hover:underline">
                            {claim.claimReference}
                          </Link>{" "}
                          <span className="text-gray-400">{CLAIM_STATUS_LABELS[claim.status] ?? claim.status}</span>
                          {claim.lines.map((line, index) => (
                            <p key={index} className="text-[10px] text-gray-500">
                              {line.description ?? line.sapItemCode ?? "Line"}: {line.reasonLabel ?? "No reason"} · accepted {line.acceptedQuantity ?? "--"} / rejected {line.rejectedQuantity ?? "--"}
                            </p>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
