import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

export type SqlValue = string | number | null | undefined;

/**
 * Thin wrapper over a D1 binding. Every value goes through `bind()`, so SQL text stays
 * a constant string and values are never concatenated into it.
 *
 * Repositories receive one of these; nothing else in the app touches D1 directly.
 */
export class Database {
  constructor(private readonly d1: D1Database) {}

  /** Prepared statement with bound values. Use with `batch()` for atomic multi-writes. */
  statement(sql: string, ...values: SqlValue[]): D1PreparedStatement {
    // D1 rejects `undefined`; treat it as SQL NULL.
    return this.d1.prepare(sql).bind(...values.map((value) => value ?? null));
  }

  async all<Row>(sql: string, ...values: SqlValue[]): Promise<Row[]> {
    const result = await this.statement(sql, ...values).all<Row>();
    return result.results;
  }

  async first<Row>(sql: string, ...values: SqlValue[]): Promise<Row | null> {
    return this.statement(sql, ...values).first<Row>();
  }

  async run(sql: string, ...values: SqlValue[]): Promise<D1Result> {
    return this.statement(sql, ...values).run();
  }

  /** D1 runs a batch as a single transaction: all statements succeed or none do. */
  async batch(statements: D1PreparedStatement[]): Promise<void> {
    if (statements.length > 0) await this.d1.batch(statements);
  }

  /** True if the binding answers a trivial query. Never exposes error details. */
  async ping(): Promise<boolean> {
    try {
      const row = await this.first<{ ok: number }>('SELECT 1 AS ok');
      return row?.ok === 1;
    } catch {
      return false;
    }
  }
}
