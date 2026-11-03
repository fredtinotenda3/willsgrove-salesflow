"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Sidebar from "../../components/sidebar";

import {
  Search,
  Bell,
  ChevronDown,
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Mail,
  X,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  MapPin,
  User,
  ClipboardList,
  ArrowRight,
  Plus,
  Paperclip,
  Info,
} from "lucide-react";

type SubmissionMethod = "document" | "message";

export default function NewOrderPage() {
  const [submissionMethod, setSubmissionMethod] =
    useState<SubmissionMethod>("document");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [messageText, setMessageText] = useState("");

  const [customer, setCustomer] = useState("");

  const [poReference, setPoReference] = useState("");

  const [orderDate, setOrderDate] = useState("2026-11-03");

  const [deliveryDate, setDeliveryDate] = useState("2026-11-04");

  const [destination, setDestination] = useState("");

  const [notes, setNotes] = useState("");

  const [submitted, setSubmitted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file?: File) => {
    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "image/png",
      "image/jpeg",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      alert("Please upload a PDF, Excel or image file.");
      return;
    }

    setSelectedFile(file);
  };

  const removeFile = () => {
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = () => {
    if (!customer) {
      alert("Please select a customer.");
      return;
    }

    if (submissionMethod === "document" && !selectedFile) {
      alert("Please upload a customer purchase order.");
      return;
    }

    if (submissionMethod === "message" && !messageText.trim()) {
      alert("Please paste the customer order message.");
      return;
    }

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">

      <Sidebar />

      <main className="min-h-screen pl-[260px]">

        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">

          <div>
            <p className="text-xs text-gray-400">
              Workspace / Orders / New Order
            </p>

            <h2 className="mt-1 text-lg font-bold text-[#17251E]">
              Receive New Order
            </h2>
          </div>

          <div className="flex items-center gap-5">

            <button className="text-gray-400 hover:text-gray-700">
              <Search size={19} />
            </button>

            <button className="relative text-gray-400 hover:text-gray-700">
              <Bell size={19} />

              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
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

        <div className="mx-auto max-w-[1200px] space-y-7 p-8">

          {/* Page heading */}
          <section>

            <Link
              href="/orders"
              className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-gray-500 transition hover:text-[#28583F]"
            >
              <ArrowLeft size={14} />
              Back to Orders
            </Link>

            <div className="flex items-center justify-between">

              <div>

                <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">
                  Receive Customer Order
                </h1>

                <p className="mt-2 text-sm text-gray-500">
                  Register a new customer purchase order for processing.
                </p>

              </div>

              <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-2 text-[11px] font-medium text-blue-700">

                <Info size={14} />

                New order registration

              </div>

            </div>

          </section>

          {/* Success message */}
          {submitted && (

            <div className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-5">

              <CheckCircle2 className="mt-0.5 text-green-600" size={20} />

              <div>

                <h3 className="text-sm font-semibold text-green-800">
                  Order registration validated
                </h3>

                <p className="mt-1 text-xs text-green-700">
                  Your information passed the basic form checks. Backend
                  submission and document processing will be implemented later.
                </p>

                <button
                  onClick={() => setSubmitted(false)}
                  className="mt-3 text-xs font-semibold text-green-800 underline"
                >
                  Continue editing
                </button>

              </div>

            </div>

          )}

          {/* Main content */}
          <div className="grid grid-cols-[1fr_320px] items-start gap-6">

            <div className="space-y-6">

              {/* Order source */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">

                <div className="mb-5">

                  <div className="flex items-center gap-2">

                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-[#28583F]">
                      <Upload size={17} />
                    </div>

                    <h2 className="text-sm font-bold text-[#17251E]">
                      Customer Order Source
                    </h2>

                  </div>

                  <p className="mt-2 text-xs text-gray-400">
                    Choose how the customer submitted their purchase order.
                  </p>

                </div>

                {/* Method selector */}
                <div className="grid grid-cols-2 gap-3">

                  <button
                    onClick={() => setSubmissionMethod("document")}
                    className={`flex items-center gap-3 rounded-lg border p-4 text-left transition ${
                      submissionMethod === "document"
                        ? "border-[#28583F] bg-green-50/50 ring-1 ring-[#28583F]"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >

                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#28583F]">
                      <FileText size={19} />
                    </div>

                    <div>

                      <p className="text-xs font-semibold text-gray-800">
                        Upload Document
                      </p>

                      <p className="mt-1 text-[10px] text-gray-400">
                        PDF, Excel or image
                      </p>

                    </div>

                  </button>

                  <button
                    onClick={() => setSubmissionMethod("message")}
                    className={`flex items-center gap-3 rounded-lg border p-4 text-left transition ${
                      submissionMethod === "message"
                        ? "border-[#28583F] bg-green-50/50 ring-1 ring-[#28583F]"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >

                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-green-600">
                      <MessageCircle size={19} />
                    </div>

                    <div>

                      <p className="text-xs font-semibold text-gray-800">
                        Paste Message
                      </p>

                      <p className="mt-1 text-[10px] text-gray-400">
                        WhatsApp or email text
                      </p>

                    </div>

                  </button>

                </div>

                {/* Document upload */}
                {submissionMethod === "document" && (

                  <div className="mt-5">

                    {!selectedFile ? (

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleFile(event.dataTransfer.files?.[0]);
                        }}
                        className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 px-6 py-12 text-center transition hover:border-[#8CA994] hover:bg-green-50/30"
                      >

                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[#28583F] shadow-sm">
                          <Upload size={23} />
                        </div>

                        <p className="mt-4 text-sm font-semibold text-gray-700">
                          Drop your customer order here
                        </p>

                        <p className="mt-2 text-xs text-gray-400">
                          or click to browse files
                        </p>

                        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">

                          <span className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[10px] text-gray-500 shadow-sm">
                            <FileText size={13} />
                            PDF
                          </span>

                          <span className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[10px] text-gray-500 shadow-sm">
                            <FileSpreadsheet size={13} />
                            Excel
                          </span>

                          <span className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-[10px] text-gray-500 shadow-sm">
                            <ImageIcon size={13} />
                            Images
                          </span>

                        </div>

                        <p className="mt-4 text-[10px] text-gray-400">
                          PDF, XLS, XLSX, PNG, JPG and WEBP
                        </p>

                      </button>

                    ) : (

                      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50/50 p-4">

                        <div className="flex min-w-0 items-center gap-3">

                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-[#28583F]">
                            <FileText size={20} />
                          </div>

                          <div className="min-w-0">

                            <p className="truncate text-xs font-semibold text-gray-800">
                              {selectedFile.name}
                            </p>

                            <p className="mt-1 text-[10px] text-gray-400">
                              {(selectedFile.size / 1024).toFixed(1)} KB
                            </p>

                          </div>

                        </div>

                        <button
                          type="button"
                          onClick={removeFile}
                          className="ml-3 rounded-lg p-2 text-gray-400 hover:bg-white hover:text-red-500"
                        >
                          <X size={17} />
                        </button>

                      </div>

                    )}

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.xls,.xlsx,.png,.jpg,.jpeg,.webp"
                      className="hidden"
                      onChange={(event) =>
                        handleFile(event.target.files?.[0])
                      }
                    />

                  </div>

                )}

                {/* Message input */}
                {submissionMethod === "message" && (

                  <div className="mt-5">

                    <div className="mb-3 flex items-center gap-2">

                      <MessageCircle size={15} className="text-green-600" />

                      <p className="text-xs font-semibold text-gray-700">
                        Customer message
                      </p>

                    </div>

                    <textarea
                      value={messageText}
                      onChange={(event) =>
                        setMessageText(event.target.value)
                      }
                      placeholder={`Example:

Good morning,

Please supply the following:

Apples Top Red - 20 boxes
Oranges - 15 boxes
Broccoli - 30 kg
Carrots - 25 kg

Delivery to our Gweru branch tomorrow.

Regards,
Purchasing Department`}
                      rows={9}
                      className="w-full resize-y rounded-lg border border-gray-200 bg-white p-4 text-xs leading-6 text-gray-700 outline-none transition placeholder:text-gray-300 focus:border-[#8CA994] focus:ring-2 focus:ring-green-50"
                    />

                    <div className="mt-2 flex items-center justify-between">

                      <p className="text-[10px] text-gray-400">
                        Paste the original customer message without changing it.
                      </p>

                      <p className="text-[10px] text-gray-400">
                        {messageText.length} characters
                      </p>

                    </div>

                  </div>

                )}

              </section>

              {/* Customer details */}
              <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">

                <div className="mb-6 flex items-center gap-3">

                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <User size={17} />
                  </div>

                  <div>

                    <h2 className="text-sm font-bold text-[#17251E]">
                      Customer & Order Details
                    </h2>

                    <p className="mt-1 text-xs text-gray-400">
                      Capture the details supplied by the customer.
                    </p>

                  </div>

                </div>

                <div className="grid grid-cols-2 gap-5">

                  <div className="col-span-2">

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Customer <span className="text-red-500">*</span>
                    </label>

                    <div className="relative">

                      <select
                        value={customer}
                        onChange={(event) => setCustomer(event.target.value)}
                        className="h-11 w-full appearance-none rounded-lg border border-gray-200 bg-white px-3 pr-9 text-xs text-gray-700 outline-none focus:border-[#8CA994] focus:ring-2 focus:ring-green-50"
                      >

                        <option value="">Select customer</option>
                        <option value="Gweru Pick n Pay">Gweru Pick n Pay</option>
                        <option value="TM Supermarket">TM Supermarket</option>
                        <option value="OK Zimbabwe">OK Zimbabwe</option>
                        <option value="SPAR Borrowdale">SPAR Borrowdale</option>
                        <option value="Pick n Pay Bulawayo">Pick n Pay Bulawayo</option>
                        <option value="Food Lovers Market">Food Lovers Market</option>
                        <option value="Choppies">Choppies</option>
                        <option value="Other">Other customer</option>

                      </select>

                      <ChevronDown
                        size={15}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />

                    </div>

                  </div>

                  <div>

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Customer PO Reference
                    </label>

                    <input
                      value={poReference}
                      onChange={(event) => setPoReference(event.target.value)}
                      placeholder="e.g. 219246"
                      className="h-11 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#8CA994] focus:ring-2 focus:ring-green-50"
                    />

                  </div>

                  <div>

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Order Date
                    </label>

                    <div className="relative">

                      <input
                        type="date"
                        value={orderDate}
                        onChange={(event) => setOrderDate(event.target.value)}
                        className="h-11 w-full rounded-lg border border-gray-200 px-3 pr-8 text-xs text-gray-600 outline-none focus:border-[#8CA994]"
                      />

                      <CalendarDays
                        size={14}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />

                    </div>

                  </div>

                  <div>

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Expected Delivery Date
                    </label>

                    <input
                      type="date"
                      value={deliveryDate}
                      onChange={(event) => setDeliveryDate(event.target.value)}
                      className="h-11 w-full rounded-lg border border-gray-200 px-3 text-xs text-gray-600 outline-none focus:border-[#8CA994]"
                    />

                  </div>

                  <div>

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Delivery Destination
                    </label>

                    <div className="relative">

                      <MapPin
                        size={15}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />

                      <input
                        value={destination}
                        onChange={(event) => setDestination(event.target.value)}
                        placeholder="Enter delivery location"
                        className="h-11 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-xs outline-none focus:border-[#8CA994]"
                      />

                    </div>

                  </div>

                  <div className="col-span-2">

                    <label className="mb-2 block text-xs font-semibold text-gray-600">
                      Internal Notes
                    </label>

                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Add any additional information for the sales team..."
                      rows={3}
                      className="w-full resize-none rounded-lg border border-gray-200 p-3 text-xs outline-none focus:border-[#8CA994]"
                    />

                  </div>

                </div>

              </section>

              {/* Submission actions */}
              <div className="flex items-center justify-between rounded-xl border border-[#E8EBE6] bg-white p-5">

                <Link
                  href="/orders"
                  className="text-xs font-semibold text-gray-500 transition hover:text-gray-800"
                >
                  Cancel
                </Link>

                <div className="flex gap-3">

                  <button
                    type="button"
                    onClick={() => alert("Draft saving will be implemented with the backend.")}
                    className="rounded-lg border border-gray-200 px-4 py-3 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    Save as Draft
                  </button>

                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-5 py-3 text-xs font-semibold text-white transition hover:bg-[#24543F]"
                  >
                    Submit for Verification
                    <ArrowRight size={15} />
                  </button>

                </div>

              </div>

            </div>

            {/* Right information panel */}
            <aside className="space-y-5">

              {/* Process information */}
              <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">

                <h3 className="text-sm font-bold text-[#17251E]">
                  Order Processing
                </h3>

                <p className="mt-1 text-xs text-gray-400">
                  What happens after receiving an order?
                </p>

                <div className="mt-6 space-y-5">

                  {[
                    {
                      number: "01",
                      title: "Order received",
                      description: "Register the customer's original submission.",
                      active: true,
                    },
                    {
                      number: "02",
                      title: "Sales verification",
                      description: "Review products, quantities and prices.",
                      active: false,
                    },
                    {
                      number: "03",
                      title: "Order approval",
                      description: "Confirm the order for processing.",
                      active: false,
                    },
                    {
                      number: "04",
                      title: "Warehouse fulfilment",
                      description: "Prepare the products for dispatch.",
                      active: false,
                    },
                    {
                      number: "05",
                      title: "Delivery",
                      description: "Dispatch and confirm customer delivery.",
                      active: false,
                    },
                  ].map((step, index) => (

                    <div key={step.number} className="flex gap-3">

                      <div className="flex flex-col items-center">

                        <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                          step.active
                            ? "bg-[#173D2E] text-white"
                            : "bg-gray-100 text-gray-400"
                        }`}>
                          {step.number}
                        </div>

                        {index !== 4 && (
                          <div className="mt-1 h-8 w-px bg-gray-200" />
                        )}

                      </div>

                      <div className="pt-1">

                        <p className={`text-xs font-semibold ${
                          step.active ? "text-[#28583F]" : "text-gray-700"
                        }`}>
                          {step.title}
                        </p>

                        <p className="mt-1 text-[10px] leading-5 text-gray-400">
                          {step.description}
                        </p>

                      </div>

                    </div>

                  ))}

                </div>

              </div>

              {/* Important note */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">

                <div className="flex items-center gap-2">

                  <AlertCircle size={17} className="text-amber-600" />

                  <h3 className="text-xs font-bold text-amber-800">
                    Important
                  </h3>

                </div>

                <p className="mt-3 text-xs leading-6 text-amber-800/80">
                  Receiving a customer purchase order does not automatically
                  reserve stock or authorize invoicing. Sales must verify
                  product availability, quantities, units and agreed prices
                  before approval.
                </p>

              </div>

              {/* Document support */}
              <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">

                <h3 className="text-xs font-bold text-gray-800">
                  Supported submissions
                </h3>

                <div className="mt-4 space-y-3">

                  <div className="flex items-center gap-3">

                    <FileText size={16} className="text-red-500" />

                    <p className="text-xs text-gray-600">
                      PDF purchase orders
                    </p>

                  </div>

                  <div className="flex items-center gap-3">

                    <FileSpreadsheet size={16} className="text-green-600" />

                    <p className="text-xs text-gray-600">
                      Excel spreadsheets
                    </p>

                  </div>

                  <div className="flex items-center gap-3">

                    <ImageIcon size={16} className="text-purple-500" />

                    <p className="text-xs text-gray-600">
                      WhatsApp images
                    </p>

                  </div>

                  <div className="flex items-center gap-3">

                    <Mail size={16} className="text-blue-500" />

                    <p className="text-xs text-gray-600">
                      Email and WhatsApp text
                    </p>

                  </div>

                </div>

              </div>

            </aside>

          </div>

          {/* Footer */}
          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">

            <p>Willsgrove SalesFlow © 2026</p>

            <p>Sales Operations Platform · Harare</p>

          </footer>

        </div>

      </main>

    </div>
  );
}