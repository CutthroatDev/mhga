import type { ProductReviewStatus } from '../../types';
import { EDITABLE_FIELDS, FIELD_LABELS, type EditableField } from './validation';

/**
 * Confirmation and error messages shown after an admin action. Endpoints redirect with a
 * short fixed CODE; the page maps it to text here. Arbitrary text from the URL is never
 * displayed, so a crafted link cannot inject content.
 */
const NOTICES = {
  approved: 'approved.',
  approved_hidden:
    'approved, but it has no eligible offer, so it will not be listed publicly until one is added (an offer from an active retailer, with an http(s) link, that is not discontinued).',
  rejected: 'rejected.',
  pending: 'moved back to pending.',
  notes_saved: 'internal notes saved.',
  updated: 'product information saved.',
} as const;

export type NoticeCode = keyof typeof NOTICES;

export function isNoticeCode(value: unknown): value is NoticeCode {
  return typeof value === 'string' && Object.hasOwn(NOTICES, value);
}

export function noticeText(code: NoticeCode, productName?: string): string {
  const subject = productName ? `“${productName}”` : 'Product';
  return `${subject} ${NOTICES[code]}`;
}

/** Notice code for a completed status change. */
export function statusNotice(status: ProductReviewStatus, isPublic: boolean): NoticeCode {
  if (status === 'approved') return isPublic ? 'approved' : 'approved_hidden';
  return status;
}

/** Turns the `fields` query value into labels, keeping only known field names. */
export function errorFieldLabels(value: string | null): string[] {
  if (!value) return [];
  const known = new Set<string>([...EDITABLE_FIELDS, 'reviewNotes']);
  return value
    .split(',')
    .filter((name): name is EditableField | 'reviewNotes' => known.has(name))
    .map((name) => FIELD_LABELS[name]);
}
