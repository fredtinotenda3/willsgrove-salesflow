import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Additional Implementation Requirements (spec section 10: "Adopt
 * shadcn/ui as the standard component system"). The standard shadcn/ui
 * class-merging helper -- every component.json-generated component in
 * components/ui/ imports this exact function under this exact name and
 * path, so it is reproduced verbatim (not renamed/relocated) to stay
 * drop-in compatible with shadcn/ui's own documentation and any
 * future `npx shadcn add` run against this project (the shadcn CLI
 * itself could not be run in this sandbox -- network access to
 * ui.shadcn.com is blocked by the outbound allowlist -- so these
 * components were authored by hand against the same contract instead;
 * see this round's delivery report).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
