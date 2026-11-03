
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Sidebar from "../../components/sidebar";

import {
  ArrowLeft,
  Bell,
  ChevronDown,
  FileText,
  Mail,
  CalendarDays,
  MapPin,
  User,
  Package,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  ShieldCheck,
  ClipboardCheck,
  Eye,
  Flag,
  Save,
  ArrowRight,
  Info,
  DollarSign,
} from "lucide-react";

type VerificationStatus = "Pending" | "Verified" | "Flagged";

export default function OrderDetailsPage() {
  const params = useParams<{ id: string }>();
  const orderReference = params.id;

  const isKnownOrder = orderReference === "PO-219246";

  const [approvedPrice, setApprovedPrice] = useState("");
  const [verificationStatus, setVerificationStatus] =
    useState<VerificationStatus>("Pending");
  const [salesNotes, setSalesNotes] = useState("");

  const customer = isKnownOrder
    ? "Gweru Pick n Pay"
    : "Demo Customer";

  const orderDate = isKnownOrder ? "03 November 2026" : "Demo record";
  const deliveryDate = isKnownOrder ? "04 November 2026" : "Not available";
  const destination = isKnownOrder
    ? "Stand No 225/6/7 Gweru Township, Gweru"
    : "Demo destination";

  const orderTotal = isKnownOrder ? 2643.41 : null;
  const vat = isKnownOrder ? 12.85 : null;
  const lineCount = isKnownOrder ? 36 : null;
  const totalUnits = isKnownOrder ? 1599 : null;

  const customerUnitPrice = isKnownOrder ? 2.70 : null;
  const productDescription = "APPLES G/D ECON 1.5KG";
  const productCode = "100089";
  const quantity = 40;

  const parsedApprovedPrice = Number(approvedPrice);
  const hasApprovedPrice =
    approvedPrice.trim() !== "" &&
    Number.isFinite(parsedApprovedPrice) &&
    parsedApprovedPrice > 0;

  const priceDifference =
    hasApprovedPrice && customerUnitPrice !== null
      ? parsedApprovedPrice - customerUnitPrice
      : null;

  const canPrepareForApproval =
    verificationStatus === "Verified" &&
    hasApprovedPrice;

  const formattedCurrency = (value: number) =>
    `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  function markVerified() {
    if (!hasApprovedPrice) {
      alert(
        "Please enter Willsgrove's approved selling price before verifying this item."
      );
      return;
    }

    setVerificationStatus("Verified");
  }

  function flagDiscrepancy() {
    setVerificationStatus("Flagged");
  }

  function saveDraft() {
    alert(
      "This verification is currently a frontend demonstration. Database saving will be implemented later."
    );
  }

  function prepareApproval() {
    if (!canPrepareForApproval) {
      alert(
        "Complete the price entry and verification checks before proceeding."
      );
      return;
    }

    alert(
      "The order has passed the available demonstration checks. Actual approval workflow will be implemented with the backend."
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">
              Workspace / Sales Management / Orders / Order Details
            </p>

            <h2 className="mt-1 text-lg font-bold text-[#17251E]">
              Order Verification
            </h2>
          </div>

          <div className="flex items-center gap-5">
            <button className="text-gray-400 hover:text-gray-700">
              <Bell size={19} />
            </button>

            <div className="h-8 w-px bg-gray-200" />

            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#173D2E]">
                SA
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-800">
                  Sales Administrator
                </p>

                <p className="text-[10px] text-gray-400">
                  Administrator
                </p>
              </div>

              <ChevronDown size={14} className="text-gray-400" />
            </div>
          </div>
        </header>

        <div className="space-y-7 p-8">
          {/* Back navigation */}
          <Link
            href="/orders"
            className="inline-flex items-center gap-2 text-xs font-medium text-gray-500 transition hover:text-[#28583F]"
          >
            <ArrowLeft size={15} />
            Back to Orders
          </Link>

          {/* Page heading */}
          <section className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">
                  {orderReference}
                </h1>

                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-[10px] font-semibold text-amber-700">
                  Pending Verification
                </span>
              </div>

              <p className="mt-2 text-sm text-gray-500">
                Review the customer purchase order and verify its products,
                quantities and selling prices.
              </p>
            </div>

            <button
              onClick={saveDraft}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              <Save size={15} />
              Save Progress
            </button>
          </section>

          {/* Demonstration notice */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
            <Info size={19} className="mt-0.5 shrink-0 text-blue-600" />

            <div>
              <p className="text-xs font-semibold text-blue-900">
                Demonstration data
              </p>

              <p className="mt-1 text-xs leading-5 text-blue-800">
                This screen currently uses sample order information.
                Only the first known product line from Gweru Pick n Pay's
                purchase order is shown. The remaining 35 product lines
                have not yet been loaded into this demonstration.
              </p>
            </div>
          </div>

          {/* Order overview */}
          <section className="grid grid-cols-4 gap-4">
            {[
              {
                label: "Customer",
                value: customer,
                icon: User,
              },
              {
                label: "Purchase Order",
                value: orderReference,
                icon: FileText,
              },
              {
                label: "Order Date",
                value: orderDate,
                icon: CalendarDays,
              },
              {
                label: "Expected Delivery",
                value: deliveryDate,
                icon: Package,
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#E8EBE6] bg-white p-5"
                >
                  <div className="flex items-center gap-2 text-gray-400">
                    <Icon size={15} />

                    <p className="text-[11px] font-medium">
                      {item.label}
                    </p>
                  </div>

                  <p className="mt-3 break-words text-sm font-semibold text-[#17251E]">
                    {item.value}
                  </p>
                </div>
              );
            })}
          </section>

          {/* Main content */}
          <div className="grid grid-cols-3 gap-6">
            {/* Left content */}
            <div className="col-span-2 space-y-6">
              {/* Customer information */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#17251E]">
                      Customer & Delivery Information
                    </h2>

                    <p className="mt-1 text-xs text-gray-400">
                      Information captured from the customer order.
                    </p>
                  </div>

                  <User size={19} className="text-gray-400" />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Customer
                    </p>

                    <p className="mt-2 text-sm font-semibold text-gray-800">
                      {customer}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Customer PO Reference
                    </p>

                    <p className="mt-2 text-sm font-semibold text-gray-800">
                      {orderReference}
                    </p>
                  </div>

                  <div className="col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Delivery Destination
                    </p>

                    <div className="mt-2 flex items-start gap-2">
                      <MapPin
                        size={15}
                        className="mt-0.5 text-gray-400"
                      />

                      <p className="text-sm text-gray-700">
                        {destination}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Original document */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-[#17251E]">
                      Original Customer Purchase Order
                    </h2>

                    <p className="mt-1 text-xs text-gray-400">
                      Preserve the original document as submitted.
                    </p>
                  </div>

                  <FileText size={20} className="text-gray-400" />
                </div>

                <div className="mt-5 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-50">
                      <FileText size={21} className="text-red-500" />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-800">
                        {orderReference} - Customer PO
                      </p>

                      <p className="mt-1 text-[10px] text-gray-400">
                        Original PDF · Email submission
                      </p>
                    </div>
                  </div>

                  <span className="rounded-md bg-gray-200 px-2 py-1 text-[10px] text-gray-600">
                    Reference only
                  </span>
                </div>

                <p className="mt-3 text-[11px] leading-5 text-gray-400">
                  The actual uploaded document viewer and download
                  functionality will be connected when document storage
                  is implemented.
                </p>
              </section>

              {/* Product verification */}
              <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 p-6">
                  <div>
                    <h2 className="text-sm font-bold text-[#17251E]">
                      Product & Price Verification
                    </h2>

                    <p className="mt-1 text-xs text-gray-400">
                      Compare the customer's requested items with
                      Willsgrove's approved selling prices.
                    </p>
                  </div>

                  <span className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-700">
                    Price review required
                  </span>
                </div>

                {/* Pricing explanation */}
                <div className="mx-6 mt-5 flex items-start gap-3 rounded-lg bg-[#F5F8F3] p-4">
                  <ShieldCheck
                    size={19}
                    className="mt-0.5 shrink-0 text-[#28583F]"
                  />

                  <div>
                    <p className="text-xs font-semibold text-[#173D2E]">
                      Sales-controlled pricing
                    </p>

                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      The Sales team determines Willsgrove's approved
                      selling price. Customer-submitted prices must be
                      checked and must never automatically become
                      approved selling prices.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto p-6">
                  <table className="w-full min-w-[650px] text-left">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="pb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Product
                        </th>

                        <th className="pb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Qty
                        </th>

                        <th className="pb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Customer Price
                        </th>

                        <th className="pb-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          Verification
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {isKnownOrder ? (
                        <tr className="border-b border-gray-50">
                          <td className="py-5 pr-4">
                            <p className="text-xs font-bold text-[#28583F]">
                              {productCode}
                            </p>

                            <p className="mt-1 text-xs font-medium text-gray-700">
                              {productDescription}
                            </p>

                            <p className="mt-1 text-[10px] text-gray-400">
                              Pack: 1.00
                            </p>
                          </td>

                          <td className="py-5 text-xs font-semibold text-gray-700">
                            {quantity}
                          </td>

                          <td className="py-5 text-xs font-semibold text-gray-700">
                            {formattedCurrency(customerUnitPrice!)}
                          </td>

                          <td className="py-5">
                            {verificationStatus === "Verified" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-[10px] font-semibold text-green-700">
                                <CheckCircle2 size={12} />
                                Verified
                              </span>
                            )}

                            {verificationStatus === "Pending" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                                <Clock3 size={12} />
                                Pending
                              </span>
                            )}

                            {verificationStatus === "Flagged" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700">
                                <AlertTriangle size={12} />
                                Flagged
                              </span>
                            )}
                          </td>
                        </tr>
                      ) : (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-12 text-center text-xs text-gray-400"
                          >
                            Product line details are not available for
                            this demonstration order.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Price approval */}
                {isKnownOrder && (
                  <div className="border-t border-gray-100 bg-gray-50/70 p-6">
                    <div className="mb-5">
                      <h3 className="text-xs font-bold text-[#17251E]">
                        Sales Price Determination
                      </h3>

                      <p className="mt-1 text-[11px] text-gray-500">
                        Enter the selling price approved by Willsgrove's
                        Sales team.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                          Customer-submitted unit price
                        </label>

                        <div className="mt-2 flex h-11 items-center rounded-lg border border-gray-200 bg-gray-100 px-3">
                          <span className="text-xs text-gray-400">$</span>

                          <span className="ml-2 text-sm font-semibold text-gray-700">
                            2.70
                          </span>

                          <span className="ml-auto text-[10px] text-gray-400">
                            Read only
                          </span>
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="approvedPrice"
                          className="text-[10px] font-semibold uppercase tracking-wider text-gray-500"
                        >
                          Willsgrove-approved unit price
                        </label>

                        <div className="mt-2 flex h-11 items-center rounded-lg border border-gray-200 bg-white px-3 focus-within:border-[#7C9D87]">
                          <DollarSign
                            size={15}
                            className="text-gray-400"
                          />

                          <input
                            id="approvedPrice"
                            type="number"
                            min="0"
                            step="0.01"
                            value={approvedPrice}
                            onChange={(event) => {
                              setApprovedPrice(event.target.value);
                              setVerificationStatus("Pending");
                            }}
                            placeholder="Enter approved price"
                            className="ml-2 w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
                          />
                        </div>
                      </div>
                    </div>

                    {priceDifference !== null && (
                      <div
                        className={`mt-4 rounded-lg p-3 ${
                          Math.abs(priceDifference) < 0.000001
                            ? "bg-green-50"
                            : "bg-amber-50"
                        }`}
                      >
                        <p
                          className={`text-xs font-semibold ${
                            Math.abs(priceDifference) < 0.000001
                              ? "text-green-700"
                              : "text-amber-700"
                          }`}
                        >
                          {Math.abs(priceDifference) < 0.000001
                            ? "Prices match"
                            : priceDifference > 0
                              ? `Willsgrove price is ${formattedCurrency(priceDifference)} higher per unit`
                              : `Willsgrove price is ${formattedCurrency(Math.abs(priceDifference))} lower per unit`}
                        </p>

                        <p className="mt-1 text-[10px] text-gray-500">
                          Difference is calculated per unit. The Sales
                          team must confirm the approved price.
                        </p>
                      </div>
                    )}

                    <div className="mt-5">
                      <label
                        htmlFor="salesNotes"
                        className="text-[10px] font-semibold uppercase tracking-wider text-gray-500"
                      >
                        Sales verification notes
                      </label>

                      <textarea
                        id="salesNotes"
                        value={salesNotes}
                        onChange={(event) =>
                          setSalesNotes(event.target.value)
                        }
                        rows={3}
                        placeholder="Record pricing decisions, product checks or any discrepancies..."
                        className="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-white p-3 text-xs outline-none transition placeholder:text-gray-400 focus:border-[#7C9D87]"
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        onClick={markVerified}
                        disabled={!hasApprovedPrice}
                        className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#24543F] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <CheckCircle2 size={15} />
                        Mark Product Verified
                      </button>

                      <button
                        onClick={flagDiscrepancy}
                        className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-3 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                      >
                        <Flag size={14} />
                        Flag Discrepancy
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Order totals */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
                <h2 className="text-sm font-bold text-[#17251E]">
                  Customer PO Summary
                </h2>

                <p className="mt-1 text-xs text-gray-400">
                  Values as supplied on the customer's original order.
                </p>

                {isKnownOrder ? (
                  <div className="mt-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        Number of line items
                      </p>

                      <p className="text-xs font-semibold text-gray-800">
                        {lineCount}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        Total units
                      </p>

                      <p className="text-xs font-semibold text-gray-800">
                        {totalUnits?.toLocaleString("en-US")}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        Subtotal before VAT
                      </p>

                      <p className="text-xs font-semibold text-gray-800">
                        {formattedCurrency(2630.56)}
                      </p>
                    </div>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500">
                        VAT
                      </p>

                      <p className="text-xs font-semibold text-gray-800">
                        {formattedCurrency(vat!)}
                      </p>
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-[#17251E]">
                          Customer PO Total
                        </p>

                        <p className="text-xl font-bold text-[#28583F]">
                          {formattedCurrency(orderTotal!)}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 text-xs text-gray-400">
                    No verified order totals are available for this
                    demonstration record.
                  </p>
                )}
              </section>
            </div>

            {/* Right sidebar */}
            <aside className="space-y-6">
              {/* Verification progress */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                <h2 className="text-sm font-bold text-[#17251E]">
                  Verification Progress
                </h2>

                <p className="mt-1 text-xs text-gray-400">
                  Current order review status.
                </p>

                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-600">
                      Product checks
                    </span>

                    <span className="text-xs font-semibold text-gray-800">
                      {verificationStatus === "Verified" ? "1 / 1" : "0 / 1"}
                    </span>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all ${
                        verificationStatus === "Verified"
                          ? "w-full bg-green-600"
                          : "w-0"
                      }`}
                    />
                  </div>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600">
                      <CheckCircle2 size={16} />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-700">
                        Order received
                      </p>

                      <p className="text-[10px] text-gray-400">
                        Customer PO captured
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                      <Clock3 size={16} />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-700">
                        Sales verification
                      </p>

                      <p className="text-[10px] text-gray-400">
                        {verificationStatus === "Verified"
                          ? "Demonstration check completed"
                          : "Awaiting review"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
                      <ShieldCheck size={16} />
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-gray-700">
                        Manager approval
                      </p>

                      <p className="text-[10px] text-gray-400">
                        Not yet available
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* Important rules */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-[#28583F]" />

                  <h2 className="text-sm font-bold text-[#17251E]">
                    Verification Rules
                  </h2>
                </div>

                <div className="mt-4 space-y-4">
                  {[
                    "Preserve the customer's original product and quantity.",
                    "Match the exact product code, grade and packaging.",
                    "Sales must determine the approved selling price.",
                    "Record and resolve price differences before approval.",
                    "Never silently change the customer's PO.",
                  ].map((rule, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <CheckCircle2
                        size={14}
                        className="mt-0.5 shrink-0 text-[#6B9652]"
                      />

                      <p className="text-[11px] leading-5 text-gray-600">
                        {rule}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Original document reminder */}
              <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-5">
                <div className="flex items-center gap-2">
                  <Info size={17} className="text-blue-600" />

                  <h2 className="text-xs font-bold text-blue-900">
                    Important
                  </h2>
                </div>

                <p className="mt-3 text-xs leading-5 text-blue-800">
                  The customer&apos;s purchase order is not the same as
                  Willsgrove&apos;s internal sales order or official tax
                  invoice. This screen does not issue invoices or
                  update SAP inventory.
                </p>
              </section>

              {/* Source information */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                <h2 className="text-sm font-bold text-[#17251E]">
                  Order Source
                </h2>

                <div className="mt-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                    <Mail size={17} className="text-blue-600" />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-gray-700">
                      Email submission
                    </p>

                    <p className="mt-1 text-[10px] text-gray-400">
                      Customer purchase order
                    </p>
                  </div>
                </div>
              </section>

              {/* Approval action */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                <h2 className="text-sm font-bold text-[#17251E]">
                  Next Step
                </h2>

                <p className="mt-2 text-xs leading-5 text-gray-500">
                  Complete the required checks before preparing this
                  order for manager approval.
                </p>

                <button
                  onClick={prepareApproval}
                  disabled={!canPrepareForApproval}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white transition hover:bg-[#24543F] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ClipboardCheck size={15} />
                  Prepare for Approval
                  <ArrowRight size={14} />
                </button>

                {!canPrepareForApproval && (
                  <p className="mt-3 text-center text-[10px] text-gray-400">
                    Complete price entry and verification first.
                  </p>
                )}

                {canPrepareForApproval && (
                  <p className="mt-3 text-center text-[10px] text-green-700">
                    Demonstration checks completed.
                  </p>
                )}
              </section>
            </aside>
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between border-t border-[#E8EBE6] pt-5 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>

            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
