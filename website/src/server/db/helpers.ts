/** New primary key. IDs are app-generated UUIDs stored as TEXT; URLs use slugs, not IDs. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Current time as ISO 8601 UTC without milliseconds, matching the column defaults. */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse a nullable JSON-array column. Bad or non-array data yields an empty list. */
export function parseJsonArray<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

/** Serialize an optional list for a JSON-array column. `undefined` stays undefined. */
export function toJsonArray(values: readonly unknown[] | null | undefined): string | null | undefined {
  if (values === undefined) return undefined;
  if (values === null || values.length === 0) return null;
  return JSON.stringify(values);
}

/**
 * Builds the `SET` list for a partial UPDATE from [column, value] pairs.
 *
 * Column names must be string LITERALS written in repository code, never derived from
 * caller input. Values are returned separately so they are always bound, never inlined.
 * Pairs whose value is `undefined` are skipped (`null` is kept, and clears the column).
 */
export function buildAssignments(fields: ReadonlyArray<readonly [column: string, value: string | number | null | undefined]>): {
  setClause: string;
  values: Array<string | number | null>;
} {
  const present = fields.filter(([, value]) => value !== undefined);
  return {
    setClause: present.map(([column]) => `${column} = ?`).join(', '),
    values: present.map(([, value]) => value as string | number | null),
  };
}

export function toBoolean(value: number): boolean {
  return value === 1;
}

export function fromBoolean(value: boolean): number {
  return value ? 1 : 0;
}
