import "server-only";

/**
 * Milestone 9 (SAP Business One Integration). Server-side-only
 * configuration resolution.
 *
 * Two independent layers, deliberately kept apart (spec section 6's
 * security requirements):
 *
 * 1. `SAP_B1_PROVIDER` (environment variable, "mock" | "live", default
 *    "mock") is the deployment-level kill switch. It can only be changed
 *    by whoever controls the server's environment, never through this
 *    app's UI or database -- mirroring this project's own existing
 *    EXTRACTION_PROVIDER convention (lib/extraction/providers -- "mock"
 *    forces the deterministic mock provider even when a real key is
 *    configured). An ADMINISTRATOR flipping IntegrationConnection.mode to
 *    LIVE in the UI has NO effect unless this environment variable also
 *    says "live" -- see lib/integrations/sap/get-adapter.ts.
 * 2. The actual credential (`SAP_B1_PASSWORD`) lives ONLY in the
 *    environment. It is never read by any API route handler that returns
 *    a response body, never included in IntegrationConnection (no such
 *    column exists on that model at all -- see prisma/schema.prisma's
 *    Milestone 9 comment), and never logged. `getSapCredential()` below
 *    is the only function in this codebase allowed to read it, and its
 *    result must never be passed to anything other than an adapter
 *    constructor.
 */

export type SapDeploymentMode = "mock" | "live";

/** The deployment-level ceiling. Defaults to "mock" -- spec section 6:
 * "Default live integration to disabled." Any value other than exactly
 * "live" (case-sensitive) is treated as "mock", so a typo or an unset
 * variable always fails safe. */
export function getSapDeploymentMode(): SapDeploymentMode {
  return process.env.SAP_B1_PROVIDER === "live" ? "live" : "mock";
}

export interface SapLiveCredentials {
  baseUrl: string;
  companyDb: string;
  username: string;
  password: string;
}

/**
 * Reads the real adapter's connection details. Returns null when any
 * required piece is missing -- this is the normal, expected state until
 * Bulawayo supplies a verified Service Layer environment and credentials
 * (see docs/sap-integration/discovery-checklist.md), not an error.
 * `baseUrl`/`companyDb`/`username` come from the non-secret
 * IntegrationConnection row (passed in by the caller, which already read
 * it via lib/integrations/sap/connection.ts); only the password is read
 * from the environment here.
 */
export function resolveSapLiveCredentials(connection: { baseUrl: string | null; companyDb: string | null; username: string | null }): SapLiveCredentials | null {
  const password = process.env.SAP_B1_PASSWORD;
  if (!connection.baseUrl || !connection.companyDb || !connection.username || !password) {
    return null;
  }
  return { baseUrl: connection.baseUrl, companyDb: connection.companyDb, username: connection.username, password };
}

/** True only when the environment both permits live mode AND a complete
 * set of live credentials is actually configured. Used by
 * get-adapter.ts as the final gate before ever constructing a
 * ServiceLayerAdapter. */
export function canUseLiveSapAdapter(connection: { baseUrl: string | null; companyDb: string | null; username: string | null }): boolean {
  return getSapDeploymentMode() === "live" && resolveSapLiveCredentials(connection) !== null;
}

/** Strips anything that could conceivably be a credential out of an
 * error message before it is stored (IntegrationOperation.lastErrorMessage
 * / IntegrationConnection.lastTestMessage) or shown in the UI. A real SAP
 * Service Layer error response is not expected to echo back a password,
 * but this is a last line of defence against a misbehaving server or a
 * URL that happens to carry a query-string secret -- never trust that the
 * far end redacted itself. */
export function sanitizeSapErrorMessage(message: string, credentials?: { password?: string; username?: string }): string {
  let sanitized = message;
  if (credentials?.password) {
    sanitized = sanitized.split(credentials.password).join("[REDACTED]");
  }
  if (credentials?.username) {
    sanitized = sanitized.split(credentials.username).join("[REDACTED]");
  }
  // Belt-and-braces: redact anything that looks like a basic-auth
  // Authorization header or a bearer token accidentally included in a
  // thrown error's message. An Authorization header value is either a
  // single token (a raw key) or a "<scheme> <credential>" pair (Basic
  // <base64>, Bearer <token>) -- matching only one token after the colon
  // left the credential half of a scheme+credential pair unredacted, so
  // this consumes up to two whitespace-separated tokens.
  sanitized = sanitized.replace(/Authorization:\s*\S+(?:\s+\S+)?/gi, "Authorization: [REDACTED]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  return sanitized.length > 500 ? `${sanitized.slice(0, 500)}…` : sanitized;
}
