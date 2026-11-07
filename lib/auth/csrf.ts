import "server-only";

/**
 * CSRF defense for cookie-authenticated mutating routes.
 *
 * The session cookie is set with `SameSite=Lax`, which already blocks the
 * browser from attaching it to a cross-site POST/PUT/PATCH/DELETE (Lax only
 * sends cookies on top-level, "safe" cross-site navigations -- GETs). This
 * check is the second, explicit layer: every mutating request's `Origin`
 * header (falling back to `Referer` when `Origin` is absent, which some
 * browsers/proxies do for same-origin requests) must match this app's own
 * origin. Together these give defense in depth rather than relying on
 * SameSite alone, which has had browser-specific exceptions over the years.
 *
 * This has nothing to do with authorisation -- it only proves the request
 * came from a page this app served. requireUser() in current-user.ts is
 * the authorisation check, and the two are applied together in every
 * mutating route handler.
 */
export type CsrfCheckResult = { ok: true } | { ok: false; message: string };

function originFromAppBaseUrl(): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function verifyCsrfOrigin(request: Request): CsrfCheckResult {
  const expected = originFromAppBaseUrl();
  if (!expected) {
    // Fail closed: a missing APP_BASE_URL is a misconfiguration, not an
    // excuse to skip the check.
    return { ok: false, message: "Server is misconfigured (APP_BASE_URL not set)." };
  }

  const origin = request.headers.get("origin");
  if (origin) {
    return origin === expected
      ? { ok: true }
      : { ok: false, message: "Request origin did not match this application." };
  }

  // No Origin header: fall back to Referer. Some same-origin requests
  // (older browsers, certain proxies) omit Origin on same-site requests.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      return refererOrigin === expected
        ? { ok: true }
        : { ok: false, message: "Request origin did not match this application." };
    } catch {
      return { ok: false, message: "Could not verify request origin." };
    }
  }

  // Neither header present: reject rather than assume same-origin. A
  // same-origin fetch() from this app's own client code always sends one
  // of these headers in every supported browser.
  return { ok: false, message: "Request is missing an Origin or Referer header." };
}
