import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { buildQuery, totalPagesFor, type SortState } from "@/lib/admin/list-query";
import { EmptyState } from "../ui";
import { BulkActionBar, RowCheckbox, SelectAllCheckbox, type BulkAction } from "./row-select";

export type Column<T> = {
  key: string;
  header: string;
  /** Allow-listed sort key (must exist in the page's sort map). */
  sortKey?: string;
  align?: "right" | "center";
  /** Hidden below this breakpoint so the table stays readable on small screens. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Hidden until the user switches the column on from the Columns menu. */
  defaultHidden?: boolean;
  render: (row: T) => ReactNode;
};

const HIDE: Record<string, string> = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };
const ALIGN: Record<string, string> = { right: "text-right", center: "text-center" };

type Props<T> = {
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowId: (row: T) => string;
  rowLabel?: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  /** The filter/sort params currently in the URL (already validated), preserved by every sort and page link. */
  params: Record<string, string | undefined>;
  sort?: SortState;
  emptyMessage?: string;
  /** Per-row action cell (buttons / dialogs). */
  rowActions?: (row: T) => ReactNode;
  bulkActions?: BulkAction[];
};

/**
 * Server-rendered enterprise table. State lives in the URL (search, filters,
 * sort, page), so every view is shareable, back-button friendly and
 * authoritative: the rows shown are exactly the rows the query returned.
 * Client islands add only what needs the browser: column visibility,
 * row selection and bulk actions.
 */
export function DataTable<T>({ id, columns, rows, rowId, rowLabel, total, page, pageSize, basePath, params, sort, emptyMessage = "No records match these filters.", rowActions, bulkActions }: Props<T>) {
  const selectable = !!bulkActions?.length;
  const pages = totalPagesFor(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const link = (over: Record<string, string | undefined>) => `${basePath}${buildQuery(params, over)}`;

  return (
    <div data-table={id} className="overflow-hidden rounded-xl border border-[#E3E8E2] bg-white shadow-[0_1px_2px_rgba(20,33,27,0.04)]">
      {rows.length === 0 ? (
        <EmptyState title="Nothing to show" message={emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-[#F7F9F6] text-[11px] font-semibold uppercase tracking-wide text-[#6B7B72]">
              <tr>
                {selectable ? <th scope="col" className="w-10 px-3 py-2.5"><SelectAllCheckbox tableId={id} ids={rows.map(rowId)} /></th> : null}
                {columns.map((c) => {
                  const sorted = sort && c.sortKey === sort.key;
                  const nextDir = sorted && sort.dir === "asc" ? "desc" : "asc";
                  return (
                    <th key={c.key} data-col={c.key} scope="col" aria-sort={sorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={`px-3 py-2.5 ${c.hideBelow ? HIDE[c.hideBelow] : ""} ${c.align ? ALIGN[c.align] : ""}`}>
                      {c.sortKey ? (
                        <Link href={link({ sort: c.sortKey, dir: nextDir, page: undefined })} className={`inline-flex items-center gap-1 hover:text-[#14211B] ${sorted ? "text-[#14211B]" : ""}`}>
                          {c.header}
                          {sorted ? (sort.dir === "asc" ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : <ChevronsUpDown size={12} className="opacity-40" aria-hidden />}
                        </Link>
                      ) : c.header}
                    </th>
                  );
                })}
                {rowActions ? <th scope="col" className="px-3 py-2.5 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EEF1ED]">
              {rows.map((row) => {
                const rid = rowId(row);
                return (
                  <tr key={rid} className="align-middle transition-colors hover:bg-[#F9FBF8]">
                    {selectable ? <td className="px-3 py-2.5"><RowCheckbox tableId={id} id={rid} label={rowLabel ? rowLabel(row) : rid} /></td> : null}
                    {columns.map((c) => <td key={c.key} data-col={c.key} className={`px-3 py-2.5 ${c.hideBelow ? HIDE[c.hideBelow] : ""} ${c.align ? ALIGN[c.align] : ""}`}>{c.render(row)}</td>)}
                    {rowActions ? <td className="px-3 py-2.5"><div className="flex flex-wrap justify-end gap-1.5">{rowActions(row)}</div></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-[#EEF1ED] px-3 py-2.5 text-xs text-[#6B7B72] sm:flex-row sm:items-center sm:justify-between">
        <span className="tabular-nums">{total === 0 ? "0 records" : `Showing ${first}–${last} of ${total}`}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">Rows:{[25, 50, 100].map((n) => <Link key={n} href={link({ pageSize: String(n), page: undefined })} className={`rounded px-1.5 py-0.5 font-medium ${n === pageSize ? "bg-[#E6F2EA] text-[#1F7A4D]" : "hover:bg-[#F1F4F0]"}`}>{n}</Link>)}</span>
          <nav aria-label="Pagination" className="flex items-center gap-1">
            {page > 1 ? <Link href={link({ page: String(page - 1) })} aria-label="Previous page" className="rounded border border-[#D5DCD4] p-1 hover:bg-[#F1F4F0]"><ChevronLeft size={14} /></Link> : <span className="rounded border border-[#EEF1ED] p-1 opacity-40" aria-hidden><ChevronLeft size={14} /></span>}
            <span className="px-1 tabular-nums">Page {page} of {pages}</span>
            {page < pages ? <Link href={link({ page: String(page + 1) })} aria-label="Next page" className="rounded border border-[#D5DCD4] p-1 hover:bg-[#F1F4F0]"><ChevronRight size={14} /></Link> : <span className="rounded border border-[#EEF1ED] p-1 opacity-40" aria-hidden><ChevronRight size={14} /></span>}
          </nav>
        </div>
      </div>
      {selectable ? <div className="px-3 pb-3"><BulkActionBar tableId={id} actions={bulkActions!} /></div> : null}
    </div>
  );
}
