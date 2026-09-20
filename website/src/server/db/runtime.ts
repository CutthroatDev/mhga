import type { D1Database } from '@cloudflare/workers-types';
import { Database } from './database';

/** Minimal shape of Astro's `locals` on the Cloudflare adapter (v12): `locals.runtime.env`. */
interface LocalsWithRuntime {
  runtime?: { env?: { DB?: D1Database } };
}

/**
 * The D1 binding for this request, or undefined when it is not configured (for example a
 * fresh checkout before the database exists). Callers decide how to fail; never let this
 * leak configuration details to a response.
 */
export function getD1(locals: LocalsWithRuntime): D1Database | undefined {
  return locals.runtime?.env?.DB;
}

export function getDatabase(locals: LocalsWithRuntime): Database | undefined {
  const d1 = getD1(locals);
  return d1 ? new Database(d1) : undefined;
}
