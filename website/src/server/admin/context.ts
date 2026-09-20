import { getD1 } from '../db/runtime';
import { createRepositories, type Repositories } from '../repositories';
import { isNoticeCode, noticeText } from './messages';
import { parseProductId } from './validation';

/** Repositories for this request, or undefined if the D1 binding is not available. */
export function getRepositories(locals: Parameters<typeof getD1>[0]): Repositories | undefined {
  const d1 = getD1(locals);
  return d1 ? createRepositories(d1) : undefined;
}

/**
 * Reads the confirmation shown after an admin action (?notice=<code>&product=<id>).
 * Only fixed codes are recognized, and the product name comes from the database, never
 * from the URL, so a crafted link cannot display arbitrary text.
 */
export async function readNotice(
  url: URL,
  repos: Repositories,
): Promise<{ text: string; productId?: string } | undefined> {
  const code = url.searchParams.get('notice');
  if (!isNoticeCode(code)) return undefined;
  const id = parseProductId(url.searchParams.get('product'));
  const product = id ? await repos.adminProducts.getById(id) : undefined;
  return { text: noticeText(code, product?.name), ...(product ? { productId: product.id } : {}) };
}
