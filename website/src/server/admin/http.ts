/**
 * Small HTTP helpers for admin endpoints. Responses never include SQL errors, stack traces,
 * or configuration, and are never cached.
 */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function textResponse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_STORE, ...headers },
  });
}

/** 405 with the mandatory Allow header. */
export function methodNotAllowed(allowed: string[]): Response {
  return textResponse(405, 'Method not allowed', { Allow: allowed.join(', ') });
}

/** Generic failure. The real error is logged on the server, never sent to the client. */
export function serverError(context: string, error: unknown): Response {
  console.error(`[admin] ${context}`, error instanceof Error ? error.message : 'unknown error');
  return textResponse(500, 'Something went wrong. Nothing was changed.');
}

/** POST-redirect-GET: a 303 to an internal path with a small set of fixed query values. */
export function redirectTo(path: string, params: Record<string, string> = {}): Response {
  const query = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: { Location: query ? `${path}?${query}` : path, ...NO_STORE },
  });
}

// Only these admin queue pages may be used as a "return to" target. Anything else (including
// external URLs or protocol-relative paths) is ignored, so this cannot become an open redirect.
const RETURN_PATHS = new Set([
  '/admin/products',
  '/admin/products/pending',
  '/admin/products/approved',
  '/admin/products/rejected',
]);

export function safeReturnPath(value: unknown, fallback: string): string {
  return typeof value === 'string' && RETURN_PATHS.has(value) ? value : fallback;
}

const MAX_BODY_BYTES = 64 * 1024;

/** Reads a submitted HTML form, or returns a Response describing why it cannot be used. */
export async function readForm(request: Request): Promise<FormData | Response> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(type)) {
    return textResponse(415, 'Unsupported content type');
  }
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return textResponse(413, 'Request too large');

  try {
    return await request.formData();
  } catch {
    return textResponse(400, 'Invalid form data');
  }
}
