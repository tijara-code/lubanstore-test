/**
 * Response headers for the static site — one source of truth for Netlify (written to
 * dist/_headers at build) and the Node server (local and end-to-end).
 *
 * CSP origins are exactly what the pages use: the Meta and Snap pixels, GA4 (gtag).
 * 'unsafe-inline' in script-src: the pixel snippets and the JSON-LD block are inline.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://sc-static.net https://tr.snapchat.com https://connect.facebook.net https://*.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "connect-src 'self' https://tr.snapchat.com https://tr6.snapchat.com https://tr-shadow.snapchat.com https://sc-static.net https://www.facebook.com https://connect.facebook.net https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  "frame-src https://tr.snapchat.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": CSP,
};

export const IMMUTABLE = "public, max-age=31536000, immutable";

/** Headers for one static path (beyond the security headers, which apply everywhere). */
export function staticHeaders(path: string): Record<string, string> {
  if (/^\/assets\//.test(path)) return { "Cache-Control": IMMUTABLE };
  if (/^\/admin(\/|$)/.test(path)) return { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
  return { "Cache-Control": "public, max-age=0, must-revalidate" };
}

/** Netlify's _headers file, made from the rules above. */
export function netlifyHeadersFile(): string {
  const block = (path: string, h: Record<string, string>) =>
    path + "\n" + Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n";
  return [
    block("/*", { ...SECURITY_HEADERS, ...staticHeaders("/") }),
    block("/assets/*", staticHeaders("/assets/x")),
    block("/admin/*", staticHeaders("/admin/")),
  ].join("\n");
}
