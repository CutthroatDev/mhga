/**
 * Logic behind `npm run ingest:local`. The launcher (scripts/ingest-local.mjs) opens the LOCAL
 * D1 simulation and calls `runLocalCli` with it, so this module never chooses a database: it
 * runs against whatever local binding it is handed. There is no remote variant, and no
 * argument that could select one (unknown arguments are refused).
 *
 * Retailer connectors are added to SOURCES. The engine is not touched.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { runIngestion } from './engine';
import { formatIngestionResult } from './report';
import type { ProductIngestionSource } from './source';
import { createFixtureSource, FIXTURE_SNAPSHOTS, type FixtureSnapshot } from './sources/fixture';

interface Output {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = `Usage: npm run ingest:local -- --source <name> [--snapshot <name>]

  --source fixture     the built-in controlled fixture (the only source so far)
  --snapshot initial   fixture feed, first state (default)
  --snapshot updated   fixture feed after changes: price, title, availability, a missing and a new listing

Runs against the LOCAL D1 database only (.wrangler/state). New products are always created pending
review; approve them in the local admin (/admin/products/pending).`;

const SOURCES: Record<string, (options: { snapshot?: string }) => ProductIngestionSource | string> = {
  fixture: ({ snapshot = 'initial' }) =>
    (FIXTURE_SNAPSHOTS as readonly string[]).includes(snapshot)
      ? createFixtureSource(snapshot as FixtureSnapshot)
      : `Unknown fixture snapshot "${snapshot}". Use one of: ${FIXTURE_SNAPSHOTS.join(', ')}.`,
};

/** Only these flags exist. Anything else (including anything that looks like `--remote`) is refused. */
function parseArgs(argv: readonly string[]): { source: string; snapshot?: string } | { error: string } {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== '--source' && flag !== '--snapshot') || value === undefined || value.startsWith('--')) {
      return { error: `Unrecognized or incomplete argument: ${String(flag)}` };
    }
    values[flag.slice(2)] = value;
  }
  if (!values['source']) return { error: 'Missing --source.' };
  return { source: values['source'], ...(values['snapshot'] ? { snapshot: values['snapshot'] } : {}) };
}

/** Returns the process exit code: 0 finished (even with skipped candidates), 1 failed, 2 bad usage. */
export async function runLocalCli(d1: D1Database, argv: readonly string[], out: Output): Promise<number> {
  const args = parseArgs(argv);
  if ('error' in args) {
    out.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }

  const create = SOURCES[args.source];
  if (!create) {
    out.error(`Unknown source "${args.source}". Available: ${Object.keys(SOURCES).join(', ')}.\n\n${USAGE}`);
    return 2;
  }
  const source = create(args.snapshot === undefined ? {} : { snapshot: args.snapshot });
  if (typeof source === 'string') {
    out.error(`${source}\n\n${USAGE}`);
    return 2;
  }

  out.log('Target: LOCAL D1 database (.wrangler/state). The remote database is never used.');
  try {
    const result = await runIngestion(d1, source, {
      onUnexpectedError: (context, error) => out.error(`[ingest] ${context}: ${error instanceof Error ? error.message : String(error)}`),
    });
    out.log(formatIngestionResult(result));
    return result.status === 'failed' ? 1 : 0;
  } catch (error) {
    out.error(`Ingestion could not run: ${error instanceof Error ? error.message : String(error)}`);
    out.error('Is the local database migrated? Run: npm run db:migrate:local');
    return 1;
  }
}
