import type { APIRoute } from 'astro';
import { getDatabase } from '../../server/db/runtime';

// On-demand (runs in the Worker). Every other page stays prerendered.
export const prerender = false;

/**
 * Minimal health check: confirms the Worker is running, the DB binding is present, and a
 * trivial query succeeds. It reports nothing else: no table names, migration state,
 * database ids, configuration, or error details.
 */
export const GET: APIRoute = async ({ locals }) => {
  const database = await getDatabase(locals)?.ping();
  const ok = database === true;

  return Response.json(
    { status: ok ? 'ok' : 'error', worker: 'ok', database: ok ? 'ok' : 'error' },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
};
