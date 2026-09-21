/**
 * The pure input rules ingestion applies before anything reaches the database: money as
 * integer cents, safe and conservative retailer URLs, exact-match category mapping, and
 * candidate validation. No database: these are plain functions.
 */
import { describe, expect, it } from 'vitest';
import { validateCandidate } from '../src/server/ingestion/candidate';
import { createCategoryMapper } from '../src/server/ingestion/category-mapping';
import { parsePriceToCents } from '../src/server/ingestion/price';
import { normalizeRetailerUrl } from '../src/server/ingestion/url';

const NOW = new Date('2026-06-15T12:00:00Z');
const context = { sourceId: 'test', retailerSlug: 'test-shop', now: NOW };
const valid = { name: 'Thing', url: 'https://shop.example/thing' };

describe('price to integer cents', () => {
  it('parses plain US amounts exactly and refuses everything ambiguous', () => {
    expect(parsePriceToCents('24.99')).toBe(2499);
    expect(parsePriceToCents('$1,299.50')).toBe(129950);
    expect(parsePriceToCents('5')).toBe(500);
    expect(parsePriceToCents('0.5')).toBe(50);
    expect(parsePriceToCents(19.99)).toBe(1999); // 19.99 * 100 is 1998.9999999999998 in floating point
    expect(parsePriceToCents(0.07)).toBe(7);

    for (const bad of ['', 'free', 'from $5', '$5 - $10', '-3', '1.999', '12,34', 19.999, -1, Number.NaN]) {
      expect(parsePriceToCents(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('retailer URL normalization', () => {
  it('accepts http(s), normalizes only what cannot change the listing, and refuses anything unsafe', () => {
    expect(normalizeRetailerUrl('  HTTPS://Shop.Example:443/Item?b=2&a=1#reviews ')).toBe('https://shop.example/Item?b=2&a=1');
    expect(normalizeRetailerUrl('https://shop.example')).toBe('https://shop.example/');

    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://shop.example/x', '//shop.example/x', '/relative', 'https://user:pass@shop.example/x', 'https://shop.example/a b', '', undefined, 42]) {
      expect(normalizeRetailerUrl(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('category mapping', () => {
  const map = createCategoryMapper({ 'Yard & Porch': 'outdoor', Costumes: 'costumes' });

  it('maps an exact retailer category (ignoring case and spacing) and nothing else, to supported categories only', () => {
    expect(map('yard  &  porch')).toBe('outdoor');
    expect(map('COSTUMES')).toBe('costumes');
    expect(map('Yard')).toBeUndefined(); // no partial or fuzzy matching
    expect(map('Halloween Yard & Porch Decor')).toBeUndefined();
    expect(map(undefined)).toBeUndefined();
    expect(() => createCategoryMapper({ Toys: 'toys' as never })).toThrow(/unsupported category/); // only supported targets
  });
});

describe('candidate validation', () => {
  it('produces a validated candidate stamped with the source and a canonical observation time', () => {
    const result = validateCandidate({ ...valid, externalId: 7, priceCents: 500, currency: 'usd' }, context);

    expect(result).toEqual({
      ok: true,
      candidate: {
        sourceId: 'test',
        retailerSlug: 'test-shop',
        name: 'Thing',
        url: 'https://shop.example/thing',
        availability: 'unknown',
        observedAt: '2026-06-15T12:00:00Z',
        externalId: '7',
        priceCents: 500,
        currency: 'USD',
      },
    });
  });

  it('clamps a future observation time, and lets an explicit discontinued flag win', () => {
    const future = validateCandidate({ ...valid, observedAt: '2027-01-01T00:00:00Z' }, context);
    const past = validateCandidate({ ...valid, observedAt: '2026-06-10T08:30:00Z' }, context);
    const malformed = validateCandidate({ ...valid, observedAt: '2026-06-10 08:30:00' }, context);

    expect(future.ok && future.candidate.observedAt).toBe('2026-06-15T12:00:00Z');
    expect(past.ok && past.candidate.observedAt).toBe('2026-06-10T08:30:00Z');
    expect(malformed.ok).toBe(false);

    const discontinued = validateCandidate({ ...valid, availability: 'in_stock', discontinued: true }, context);
    expect(discontinued.ok && discontinued.candidate.availability).toBe('discontinued');
  });

  it('rejects a malformed external id instead of silently ignoring it (which could create a duplicate)', () => {
    for (const externalId of ['', '   ', {}, 1.5]) {
      expect(validateCandidate({ ...valid, externalId }, context).ok, JSON.stringify(externalId)).toBe(false);
    }
  });
});
