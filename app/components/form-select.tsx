"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * shadcn `Select` for plain GET/POST forms rendered by Server Components.
 * Radix Select can't hold an empty-string value, but these filters use ""
 * to mean "any"; this wrapper shows the first option for "" and submits the
 * REAL value ("" included) through a hidden input, so the server contract
 * (query params) is unchanged. Controlled use: pass `value` + `onValueChange`.
 */
const ANY = "__any__";

export type FormSelectOption = { value: string; label: string };

type FormSelectProps = {
  id?: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  options: FormSelectOption[];
  className?: string;
  "aria-label"?: string;
};

export function FormSelect({ id, name, defaultValue = "", value, onValueChange, options, className, ...rest }: FormSelectProps) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value !== undefined ? value : internal;
  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <Select
        value={current === "" ? ANY : current}
        onValueChange={(next) => {
          const real = next === ANY ? "" : next;
          if (value === undefined) setInternal(real);
          onValueChange?.(real);
        }}
      >
        <SelectTrigger id={id} className={className ?? "w-full text-xs"} aria-label={rest["aria-label"]}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value === "" ? ANY : option.value} value={option.value === "" ? ANY : option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
