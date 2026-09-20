/**
 * An isolated, in-memory D1 database for tests, built from the project's REAL migrations.
 *
 *  - Uses Miniflare's D1 (the same workerd/SQLite engine as local D1).
 *  - In-memory: no persistence directory is configured, so nothing is written to
 *    .wrangler/state (the developer's normal local database) and nothing is shared between
 *    test files.
 *  - Never reads wrangler.jsonc, so it has no way to reach the remote database.
 *  - The schema comes from migrations/*.sql, applied in order. If a future migration breaks
 *    the repositories, the tests fail.
 */
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';

// The project's real migration files, loaded as raw text by Vite (no Node fs types needed).
// Keys are file paths, so sorting them applies the migrations in numbered order.
const MIGRATION_FILES = import.meta.glob<string>('../../migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Splits a migration file into statements. Deliberately simple: strips `--` comments and
 * splits on `;`. That is enough for plain CREATE TABLE / CREATE INDEX migrations. If a future
 * migration needs triggers (which contain `;` inside BEGIN ... END), this fails loudly instead
 * of silently mis-applying it, and the splitter should be improved.
 */
function splitStatements(sql: string, file: string): string[] {
  const statements = sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    if (/\bBEGIN\b/i.test(statement)) {
      throw new Error(`${file}: contains BEGIN...END (a trigger?). Improve splitStatements in tests/helpers/test-db.ts.`);
    }
  }
  return statements;
}

async function applyMigrations(d1: D1Database): Promise<void> {
  const files = Object.keys(MIGRATION_FILES).sort();
  if (files.length === 0) throw new Error('No migrations found in migrations/*.sql');

  for (const file of files) {
    for (const statement of splitStatements(MIGRATION_FILES[file] as string, file)) {
      await d1.prepare(statement).run();
    }
  }
}

export interface TestDatabase {
  d1: D1Database;
  /** Removes every row from every table (keeps the schema), so each test starts empty. */
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    compatibilityDate: '2025-09-01',
    // No d1Persist: in-memory only.
    d1Databases: { DB: 'catalog-tests' },
  });

  // Miniflare's bundled D1 types are structurally the same as @cloudflare/workers-types.
  const d1 = (await miniflare.getD1Database('DB')) as unknown as D1Database;
  await applyMigrations(d1);

  return {
    d1,
    async clear() {
      const tables = await d1
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'")
        .all<{ name: string }>();
      // One transaction; foreign keys are checked at commit, when everything is gone.
      await d1.batch([
        d1.prepare('PRAGMA defer_foreign_keys = true'),
        ...tables.results.map((table) => d1.prepare(`DELETE FROM "${table.name}"`)),
      ]);
    },
    async dispose() {
      await miniflare.dispose();
    },
  };
}
