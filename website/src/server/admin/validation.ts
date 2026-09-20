/**
 * Server-side validation for admin input. Browser attributes (required, maxlength) are only
 * a convenience; everything here is re-checked on the server and is the source of truth.
 */
import type { ProductDetailItem, ProductReviewStatus } from '../../types';
import type { ProductUpdate } from '../domain/catalog';
import { isReviewStatus } from '../repositories/products';

export const LIMITS = {
  name: 200,
  summary: 500,
  description: 5000,
  reviewNotes: 5000,
  qualityNote: 300,
  qualityNotes: 20,
  badge: 40,
  badges: 10,
  detailLabel: 60,
  detailValue: 200,
  details: 20,
} as const;

export type EditableField =
  | 'name'
  | 'summary'
  | 'description'
  | 'categoryId'
  | 'qualityNotes'
  | 'badges'
  | 'details';

/** Field names allowed to appear in an error redirect (and be shown to the reviewer). */
export const EDITABLE_FIELDS: readonly EditableField[] = [
  'name',
  'summary',
  'description',
  'categoryId',
  'qualityNotes',
  'badges',
  'details',
];

export const FIELD_LABELS: Record<EditableField | 'reviewNotes', string> = {
  name: 'Name',
  summary: 'Summary',
  description: 'Description',
  categoryId: 'Category',
  qualityNotes: 'Quality notes',
  badges: 'Badges',
  details: 'Details',
  reviewNotes: 'Internal review notes',
};

// Control characters other than tab / newline / carriage return.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_SHAPE = /^[a-z0-9-]{1,120}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false };

/** A product id (UUID). Anything else is rejected before touching the database. */
export function parseProductId(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_SHAPE.test(value) ? value.toLowerCase() : undefined;
}

/** A UUID or a slug (for admin page URLs). */
export function parseProductIdOrSlug(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return UUID_SHAPE.test(value) || SLUG_SHAPE.test(value) ? value : undefined;
}

export function parseReviewStatus(value: unknown): ProductReviewStatus | undefined {
  return typeof value === 'string' && isReviewStatus(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  // Uploaded files or other non-string form values are invalid.
  if (typeof value !== 'string') return undefined;
  if (CONTROL_CHARS.test(value)) return undefined;
  return value.replace(/\r\n?/g, '\n');
}

function requiredLine(value: unknown, max: number): string | undefined {
  const v = text(value)?.trim();
  if (!v || v.length > max || v.includes('\n')) return undefined;
  return v;
}

/** Empty (after trimming) becomes null, meaning "clear". Too long or invalid is undefined. */
function optionalBlock(value: unknown, max: number): string | null | undefined {
  const v = text(value)?.trim();
  if (v === undefined) return undefined;
  if (v === '') return null;
  return v.length > max ? undefined : v;
}

function lines(value: unknown): string[] | undefined {
  const v = text(value);
  if (v === undefined) return undefined;
  return v
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Internal review notes: optional, up to 5000 characters. Empty clears them. */
export function parseReviewNotes(value: unknown): Parsed<string | null> {
  const parsed = optionalBlock(value, LIMITS.reviewNotes);
  return parsed === undefined ? { ok: false } : { ok: true, value: parsed };
}

function parseList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  const items = lines(value);
  if (!items || items.length > maxItems || items.some((item) => item.length > maxLength)) {
    return undefined;
  }
  return items;
}

/** "Label: Value" per line. */
function parseDetails(value: unknown): ProductDetailItem[] | undefined {
  const items = lines(value);
  if (!items || items.length > LIMITS.details) return undefined;

  const details: ProductDetailItem[] = [];
  for (const line of items) {
    const separator = line.indexOf(':');
    if (separator < 1) return undefined;
    const label = line.slice(0, separator).trim();
    const detailValue = line.slice(separator + 1).trim();
    if (!label || !detailValue) return undefined;
    if (label.length > LIMITS.detailLabel || detailValue.length > LIMITS.detailValue) return undefined;
    details.push({ label, value: detailValue });
  }
  return details;
}

export type ProductEditResult =
  | { ok: true; update: ProductUpdate }
  | { ok: false; fields: EditableField[] };

/**
 * Validates the product edit form. Required text can never become empty/invalid; the
 * category must be one that exists. Returns the invalid field names on failure.
 */
export function parseProductEdit(
  form: FormData,
  validCategoryIds: ReadonlySet<string>,
): ProductEditResult {
  const invalid: EditableField[] = [];

  const name = requiredLine(form.get('name'), LIMITS.name);
  if (name === undefined) invalid.push('name');

  const summary = requiredLine(form.get('summary'), LIMITS.summary);
  if (summary === undefined) invalid.push('summary');

  const description = optionalBlock(form.get('description'), LIMITS.description);
  if (description === undefined) invalid.push('description');

  const categoryId = form.get('categoryId');
  if (typeof categoryId !== 'string' || !validCategoryIds.has(categoryId)) invalid.push('categoryId');

  const qualityNotes = parseList(form.get('qualityNotes'), LIMITS.qualityNotes, LIMITS.qualityNote);
  if (qualityNotes === undefined) invalid.push('qualityNotes');

  const badges = parseList(form.get('badges'), LIMITS.badges, LIMITS.badge);
  if (badges === undefined) invalid.push('badges');

  const details = parseDetails(form.get('details'));
  if (details === undefined) invalid.push('details');

  if (invalid.length > 0) return { ok: false, fields: invalid };

  return {
    ok: true,
    update: {
      name: name as string,
      summary: summary as string,
      description: description as string | null,
      categoryId: categoryId as string,
      qualityNotes: qualityNotes as string[],
      badges: badges as string[],
      details: details as ProductDetailItem[],
    },
  };
}
