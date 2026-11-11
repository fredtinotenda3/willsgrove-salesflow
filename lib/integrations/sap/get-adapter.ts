import "server-only";
import { canUseLiveSapAdapter, resolveSapLiveCredentials } from "@/lib/integrations/sap/config";
import { getOrCreateConnection } from "@/lib/integrations/sap/connection";
import { MockSapAdapter } from "@/lib/integrations/sap/mock-adapter";
import { ServiceLayerAdapter } from "@/lib/integrations/sap/real-adapter";
import type { SapAdapter } from "@/lib/integrations/sap/types";

/**
 * Milestone 9 (SAP Business One Integration). The ONE choke point every
 * business/sync module goes through to reach SAP (spec section 5.1) --
 * no other file in this codebase is allowed to `new MockSapAdapter()` or
 * `new ServiceLayerAdapter()` directly.
 *
 * Resolution order, all of which must agree before a live call is ever
 * attempted (defense-in-depth, spec section 6's "default live
 * integration to disabled"):
 *   1. SAP_B1_PROVIDER environment variable must literally be "live"
 *      (lib/integrations/sap/config.ts's getSapDeploymentMode) --
 *      otherwise mock, full stop, regardless of anything below.
 *   2. The DB-level IntegrationConnection row's own `mode` must also be
 *      LIVE and `enabled` must be true -- an ADMINISTRATOR has to have
 *      actually turned it on.
 *   3. A complete, non-empty set of live credentials must actually be
 *      configured (baseUrl/companyDb/username on the connection row,
 *      SAP_B1_PASSWORD in the environment).
 * If any one of these isn't satisfied, this falls back to the mock
 * adapter rather than throwing -- a deployment that hasn't finished
 * configuring live SAP access should keep working against the mock, not
 * break.
 */
export async function getSapAdapter(): Promise<SapAdapter> {
  const connection = await getOrCreateConnection();

  if (!connection.enabled || connection.mode !== "LIVE" || !canUseLiveSapAdapter(connection)) {
    return new MockSapAdapter();
  }

  const credentials = resolveSapLiveCredentials(connection);
  // canUseLiveSapAdapter already checked this is non-null, but TypeScript
  // can't see that across the function boundary -- and re-checking here
  // is also the correct defensive posture: never construct a
  // ServiceLayerAdapter with a partially-missing credential.
  if (!credentials) return new MockSapAdapter();

  return new ServiceLayerAdapter(credentials);
}

/** True when getSapAdapter() would currently return the mock adapter --
 * used by UI/dashboard code (lib/integrations/sap/display.ts and the
 * /integrations/sap pages) to show "Running in MOCK mode" banners
 * honestly, without duplicating the resolution logic above. */
export async function isSapRunningInMockMode(): Promise<boolean> {
  const connection = await getOrCreateConnection();
  return connection.enabled === false || connection.mode !== "LIVE" || !canUseLiveSapAdapter(connection);
}
