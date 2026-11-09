/**
 * Shared helpers for date-ONLY values ("YYYY-MM-DD", no time component) --
 * the one place that shape gets converted to and from what Prisma's
 * `@db.Date` columns actually require.
 *
 * Milestone 0 fix (round 5): `CustomerOrder.orderDate` and
 * `.requestedDeliveryDate` are `DateTime? @db.Date` (prisma/schema.prisma).
 * lib/order-validation.ts's `dateOnlyString` Zod schema validates the
 * SHAPE of an incoming "YYYY-MM-DD" string, but -- having no
 * `.transform()` -- leaves its inferred TYPE as a plain `string`. Passing
 * that string straight through to a Prisma `DateTime` field (which is
 * exactly what lib/orders.ts did before this fix) fails at the database
 * driver level:
 *
 *   Invalid value for argument `orderDate`: premature end of input.
 *   Expected ISO-8601 DateTime.
 *
 * Prisma's DateTime columns accept a JS `Date` object or a FULL ISO-8601
 * *datetime* string (with a time component) -- never a bare ISO-8601
 * *date* string. TypeScript can't catch this on its own: Prisma's
 * generated input type for a DateTime field is `Date | string`, and a
 * bare "2026-11-09" is just as much a `string` as
 * "2026-11-09T00:00:00.000Z" is, so this is a runtime value-format bug
 * that no amount of static type-checking can see (see CHANGES.md's round
 * 5 section, "why round 3's tests and the sandbox didn't catch this", for
 * the full explanation).
 *
 * This file is the one shared place the "YYYY-MM-DD" <-> Date conversion
 * happens, in both directions, so no other call site has to re-derive it
 * (or get it subtly wrong in a different way) by hand.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a string that is both shaped like "YYYY-MM-DD" AND names
 * a calendar date that actually exists -- e.g. "2026-02-30" and
 * "2026-02-29" (2026 is not a leap year) are both rejected, even though
 * they match the regex. JS's `Date` constructor does NOT reject those: it
 * silently rolls them forward ("2026-02-30" becomes 2 March), which would
 * otherwise let a clearly-wrong date through and silently store the wrong
 * day. Checked by round-tripping the parsed date back to a "YYYY-MM-DD"
 * string and requiring an exact match, rather than trusting
 * `Date.prototype.getTime()` not being `NaN` (which Feb-30-style
 * overflows also pass) -- this is the one check robust to that rollover.
 */
export function isValidDateOnlyString(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString().slice(0, 10) === value;
}

/**
 * Converts a "YYYY-MM-DD" string to the `Date` Prisma needs for a
 * `@db.Date` column: UTC midnight on that calendar day. A `@db.Date`
 * column has no time-of-day or timezone of its own, so UTC midnight is
 * the only representation that can't be shifted onto a different day by
 * whatever timezone the Node process or the database connection happens
 * to be running in.
 *
 * Returns `null` for `null`/`undefined` (every date-only field in this
 * schema is optional). Throws for anything else that isn't a valid
 * date-only string -- deliberately: every caller of this function
 * receives its input from `lib/order-validation.ts`'s Zod schema, which
 * now uses `isValidDateOnlyString` itself (see that file), so reaching
 * this function with an invalid string means something upstream skipped
 * validation. Failing loudly here is far better than silently storing the
 * wrong date or letting Prisma's own, less specific error surface instead.
 */
export function dateOnlyStringToUtcDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isValidDateOnlyString(value)) {
    throw new Error(`Not a valid date-only (YYYY-MM-DD) string: ${JSON.stringify(value)}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * The inverse of `dateOnlyStringToUtcDate`: formats a `Date` (as read back
 * from a Prisma `@db.Date` column, or from `JSON.parse`-ing an API
 * response that passed one through `.toISOString()`) as its "YYYY-MM-DD"
 * string, read in UTC. Never uses the local timezone -- a `@db.Date`
 * column has no time component, so reading it back through anything but
 * UTC risks the calendar day shifting by one depending on the server's or
 * browser's local offset from UTC. This is the server-side half of the
 * round-5 UI fix; see `lib/order-display.ts`'s `formatOrderDate` for the
 * client-side half (same principle, applied to a human-readable label
 * instead of a machine-readable string).
 */
export function utcDateToDateOnlyString(date: Date | null | undefined): string | null {
  if (date === null || date === undefined) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}
