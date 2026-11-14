import type { NextConfig } from "next";

/**
 * Milestone 16 (Production Readiness), spec section 4.4. Global
 * browser-security headers, applied to EVERY response (pages, Route
 * Handlers, static assets alike) via Next's own header-injection layer --
 * independent of app/-level route segment config or Cache Components, so
 * this is unaffected by `cacheComponents` above.
 *
 * Before this milestone the only security header in the codebase was a
 * per-route `X-Content-Type-Options: nosniff` on the four file-download
 * routes (lib/storage-backed GET handlers); there was no site-wide
 * clickjacking, MIME-sniffing, referrer, or permissions baseline at all.
 * This fixes that gap WITHOUT adding a Content-Security-Policy strict
 * enough to risk breaking Next's own hydration script or next/font/google
 * (app/layout.tsx uses Geist/Geist_Mono) -- a nonce-based strict CSP would
 * need a real build+runtime pass to validate safely, which this sandbox
 * cannot do (next build is network-blocked here on the Google Fonts
 * fetch, a pre-existing, already-documented sandbox limitation, not
 * something this milestone introduces). The policy below is deliberately
 * the safe, non-breaking baseline: no inline-script/style tightening, no
 * invented guarantee of XSS immunity -- see docs/production/
 * SECURITY-REVIEW.md for what this does and does not cover, and the
 * explicit recommendation to verify a stricter CSP against a real build
 * before go-live.
 *
 * `script-src` adds 'unsafe-eval' ONLY outside production. React's
 * development build calls eval() itself -- not HMR wiring, but
 * react-dom's own dev-mode instrumentation for reconstructing component
 * stacks -- and a CSP without 'unsafe-eval' makes the browser block it
 * outright, which surfaces as a console error on every page in `next dev`
 * ("eval() is not supported in this environment... React requires eval()
 * in development mode"). This was missed by this milestone's own CSP
 * verification (SECURITY-REVIEW.md section 4): that check confirmed the header's
 * VALUE via `curl` against `next dev`, which proves the header is present
 * and correctly formed but never loads the page in an actual browser, so
 * it couldn't have caught a browser-side eval() block. Scoping the
 * relaxation to non-production changes nothing about the policy a real
 * deployed build sends -- react-dom's production build "will never use
 * eval()" (its own warning's wording) -- so the verified-safe production
 * baseline in SECURITY-REVIEW.md is unchanged; only `next dev` gets the
 * extra allowance it actually needs.
 */
async function headers() {
  const isProduction = process.env.NODE_ENV === "production";

  const securityHeaders = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    // Only honoured by browsers on an HTTPS response -- harmless to send
    // unconditionally over plain HTTP in local development.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    {
      key: "Content-Security-Policy",
      value: [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    },
  ];

  return [{ source: "/:path*", headers: securityHeaders }];
}

const nextConfig: NextConfig = {
  /* config options here */
  // Milestone 16 (Production Readiness) finding: `experimental.agentFeedback`
  // was left enabled in the repository this milestone started from. It is a
  // real Next.js 16.4.4 feature (see node_modules/next/dist/server/lib/
  // generate-agent-files.js), not a mistake in this file's syntax -- but its
  // effect is to make `next dev` write an AGENTS.md file at the repo root
  // containing instructions AIMED AT AI CODING ASSISTANTS, including a step
  // that runs `next internal agent-feedback-instructions` and reports
  // "anonymized" facts about the current coding session back to Next.js/
  // Vercel. There is no record of Willsgrove management reviewing or
  // approving sending any telemetry about this proprietary sales
  // application to a third party, and turning this on is a data-governance
  // decision, not a build setting -- see docs/production/SECURITY-REVIEW.md
  // section on repository integrity. Disabled here; re-enabling it is a
  // decision for Willsgrove management to make explicitly, not an inherited
  // default.
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  headers,
};

export default nextConfig;
