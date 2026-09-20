/**
 * TEMPORARY, LOCAL-ONLY admin access control.
 *
 * ⚠️  THIS IS NOT AUTHENTICATION. It does not identify anyone. It only makes the admin
 * interface exist at all when the site is running as a local development server, and
 * refuses it everywhere else. When the site has a production hostname, real authentication
 * (Cloudflare Access) must be added in front of the admin, and this guard should be kept
 * as an additional layer or replaced deliberately (see README.md, "Admin").
 *
 * How it stays safe by default:
 *  - There is NO environment variable, flag, or setting that enables admin. Nothing can be
 *    misconfigured into allowing production access.
 *  - It depends on `import.meta.env.DEV`, which the build replaces with the constant
 *    `false` in every production build (including the Cloudflare Worker bundle). A deployed
 *    site therefore cannot pass this check, regardless of its environment variables.
 *  - Even in a dev server it also requires a loopback hostname, so exposing the dev server
 *    on a network (`astro dev --host`) does not expose the admin.
 *
 * This is the ONLY place that decides whether admin is available. Do not copy `DEV`
 * checks elsewhere: call `localAdminDenied()` (or rely on src/middleware.ts).
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True only for a local development server reached via a loopback address. */
export function isLocalAdminAvailable(request: Request): boolean {
  // Compiled to `false` in production builds. This must stay the first check.
  if (!import.meta.env.DEV) return false;

  try {
    return LOOPBACK_HOSTNAMES.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

/** A non-revealing response: identical to an ordinary "not found". */
function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for state-changing requests: the browser must report an `Origin` that
 * matches this server. We cannot rely on Astro's `security.checkOrigin`, which does not run
 * in the dev server, and the admin is only ever enabled in the dev server. Without this,
 * any web page open on the same machine could post to http://localhost:4321/api/admin/*.
 * Browsers always send `Origin` on cross-origin POSTs; a request with none is refused too.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function forbidden(): Response {
  return new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Returns a Response when admin access must be refused, otherwise undefined:
 *  - 404 when local admin is not available (production, or a non-loopback host)
 *  - 403 when a state-changing request is not same-origin
 *
 * Every admin page and admin write endpoint calls this first (and src/middleware.ts calls
 * it for the whole admin area):
 *
 *   const denied = localAdminDenied(request);
 *   if (denied) return denied;
 */
export function localAdminDenied(request: Request): Response | undefined {
  if (!isLocalAdminAvailable(request)) return notFound();
  if (!SAFE_METHODS.has(request.method.toUpperCase()) && !isSameOrigin(request)) return forbidden();
  return undefined;
}

/**
 * True for any path that belongs to the admin area (pages under /admin and write endpoints
 * under /api/admin). Used by the middleware to guard the whole area in one place, so a new
 * admin route is protected automatically. Normalizes case, encoding, and repeated slashes.
 */
export function isAdminPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape sequence is never a legitimate admin URL; treat it as admin so it
    // is refused rather than passed through.
    return true;
  }
  const normalized = path.toLowerCase().replace(/\/{2,}/g, '/');
  return /^\/(api\/)?admin(\/|$)/.test(normalized);
}
