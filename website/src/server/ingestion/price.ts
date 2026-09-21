/**
 * Price text -> integer cents, for connectors whose source gives prices as text or dollars.
 * Parsing lives here (not in the database layer): ingestion candidates carry INTEGER CENTS only.
 *
 * Deliberately strict. It understands plain US-style amounts ("24.99", "$1,299.00", 5) and
 * returns undefined for anything else (ranges, "from $5", other currency formats), so a
 * connector must decide what to do instead of the engine guessing. It never uses binary
 * floating point for strings: the digits are converted directly.
 */

const US_AMOUNT = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

export function parsePriceToCents(value: string | number): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return undefined;
    const cents = Math.round(value * 100);
    // Reject fractions of a cent (24.999) instead of silently rounding them.
    return Math.abs(value * 100 - cents) < 1e-6 && Number.isSafeInteger(cents) ? cents : undefined;
  }

  const match = US_AMOUNT.exec(value.trim());
  if (!match) return undefined;
  const dollars = Number((match[1] as string).replaceAll(',', ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : undefined;
}
