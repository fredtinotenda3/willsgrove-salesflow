import "server-only";
import packageJson from "@/package.json";

/**
 * Milestone 16 (Production Readiness), spec section 9. Non-sensitive
 * build/version/environment facts safe to disclose on an unauthenticated
 * health endpoint -- deliberately nothing more than this. No internal
 * configuration, host path, dependency version, or infrastructure detail
 * is exposed here; see docs/production/OPERATIONS-HANDBOOK.md section 3
 * for why the health endpoint stops at exactly this much.
 */
export type AppInfo = {
  /** From package.json -- bumped by whoever cuts a release, not automatic. */
  version: string;
  /**
   * An opaque build identifier for correlating a running process with the
   * commit/build that produced it, when the host sets one. Deliberately
   * read from an environment variable the deploy pipeline is expected to
   * set (common convention: the CI commit SHA or a CI build number) --
   * this project does not assume git is even available at runtime, so it
   * never shells out to `git rev-parse` here. Falls back to "unknown"
   * rather than throwing, since a missing build id should never make the
   * health check itself fail.
   */
  buildId: string;
  /** "development" | "production" | "test" -- never a secret, already visible to anyone who can read a response header in dev tooling. */
  environment: string;
};

export function getAppInfo(): AppInfo {
  return {
    version: packageJson.version,
    buildId: process.env.BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || "unknown",
    environment: process.env.NODE_ENV ?? "unknown",
  };
}
