"use client";

import { useState } from "react";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Date picker built from the existing shadcn `calendar` + `popover` +
 * `button`. Values are calendar-day strings ("YYYY-MM-DD", the same shape
 * <input type="date"> produced), parsed and formatted in LOCAL time so a day
 * never shifts across the UTC boundary.
 *
 * Works two ways, so it can replace native date inputs everywhere:
 *   - Controlled:   <DatePicker value={v} onValueChange={setV} />
 *   - Plain GET form (server pages): <DatePicker name="dateFrom" defaultValue="..." />
 *     -- a hidden input carries the value into the form submission.
 *
 * `DateRangePicker` below pairs two of them as a from/to filter and keeps the
 * range coherent (the end date can't precede the start date).
 */
const ISO_DAY = "yyyy-MM-dd";

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, ISO_DAY, new Date());
  return isValid(parsed) ? parsed : undefined;
}

type DatePickerProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabledBefore?: string;
  disabledAfter?: string;
  "aria-label"?: string;
};

export function DatePicker({ name, value, defaultValue = "", onValueChange, placeholder = "Pick a date", className, disabledBefore, disabledAfter, ...rest }: DatePickerProps) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const current = value !== undefined ? value : internal;
  const selected = toDate(current);
  const before = toDate(disabledBefore);
  const after = toDate(disabledAfter);

  function commit(next: string) {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {name && <input type="hidden" name={name} value={current} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" aria-label={rest["aria-label"] ?? placeholder} className={cn("h-9 min-w-0 flex-1 justify-start px-3 text-left text-xs font-normal", !selected && "text-muted-foreground")}>
            <CalendarIcon />
            <span className="truncate">{selected ? format(selected, "d MMM yyyy") : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={[...(before ? [{ before }] : []), ...(after ? [{ after }] : [])]}
            onSelect={(day) => {
              commit(day ? format(day, ISO_DAY) : "");
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {selected && (
        <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Clear date" onClick={() => commit("")}>
          <X />
        </Button>
      )}
    </div>
  );
}

type DateRangePickerProps = {
  fromName?: string;
  toName?: string;
  from?: string;
  to?: string;
  defaultFrom?: string;
  defaultTo?: string;
  onChange?: (range: { from: string; to: string }) => void;
  className?: string;
};

export function DateRangePicker({ fromName, toName, from, to, defaultFrom = "", defaultTo = "", onChange, className }: DateRangePickerProps) {
  const [internalFrom, setInternalFrom] = useState(defaultFrom);
  const [internalTo, setInternalTo] = useState(defaultTo);
  const currentFrom = from !== undefined ? from : internalFrom;
  const currentTo = to !== undefined ? to : internalTo;

  function update(nextFrom: string, nextTo: string) {
    // Keep the range coherent: a start after the end drops the end.
    const coherentTo = nextFrom && nextTo && nextTo < nextFrom ? "" : nextTo;
    if (from === undefined) setInternalFrom(nextFrom);
    if (to === undefined) setInternalTo(coherentTo);
    onChange?.({ from: nextFrom, to: coherentTo });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <DatePicker name={fromName} value={currentFrom} onValueChange={(next) => update(next, currentTo)} placeholder="From" disabledAfter={currentTo || undefined} aria-label="From date" className="w-40" />
      <DatePicker name={toName} value={currentTo} onValueChange={(next) => update(currentFrom, next)} placeholder="To" disabledBefore={currentFrom || undefined} aria-label="To date" className="w-40" />
    </div>
  );
}
