/**
 * The URL import pipeline: reviewer-submitted URLs in, per-URL results out.
 *
 *   raw URLs -> prepareUrls (normalize, reject unsafe, dedupe)         no network
 *            -> fetch + extract each remaining URL (bounded concurrency) never throws for one URL
 *            -> group the products by retailer
 *            -> runIngestion() once per retailer with a URL-import source   the EXISTING engine
 *            -> one result row per submitted URL
 *
 * There is no second way to create products here. Everything that reaches the database goes
 * through `runIngestion`, so its guarantees hold unchanged: new products are `pending`, nothing is
 * approved, review status and curated fields are never overwritten, identity is retailer + listing
 * id else exact URL, an inactive retailer is not reactivated, and `affiliate_url` and `is_primary`
 * are never touched.
 *
 * One URL failing (unreachable, blocked, not a product page, conflicting identity) never stops the
 * others. Messages shown to the reviewer are fixed or engine-written text: never a remote response
 * body, a raw error, SQL, or a stack trace.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { createIngestionRepositories } from '../../repositories';
import type { IngestibleCategorySlug } from '../category-mapping';
import { runIngestion, type ItemReport } from '../engine';
import { createUrlImportSource } from '../sources/url-import';
import type { RetailerDescriptor } from '../source';
import { cleanText } from '../text';
import { extractProduct, type ExtractedProduct } from './extract-product';
import { scanHtml } from './html';
import { MAX_IMPORT_URLS, prepareUrls, type SkipReason } from './input';
import type { PageFetcher } from './page-fetcher';
import { describeRetailer } from './retailer-identity';

export type ImportStatus = 'imported' | 'updated' | 'unchanged' | 'skipped' | 'conflict' | 'failed';

/** The outcome for one submitted line. */
export interface ImportRowResult {
  /** What the reviewer submitted (cleaned and shortened for display). */
  input: string;
  status: ImportStatus;
  /** A short explanation. Fixed or engine-written text only. */
  message: string;
  /** The product to open in the review interface (imported, updated and unchanged rows). */
  productId?: string;
}

export interface ImportSummary {
  submitted: number;
  imported: number;
  updated: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  failed: number;
}

export interface UrlImportReport {
  results: ImportRowResult[];
  summary: ImportSummary;
}

export interface UrlImportRequest {
  /** Raw submitted URLs, from the text area and/or a CSV. */
  urls: readonly string[];
  /** Applied to NEW products only. Chosen by the reviewer; never inferred. */
  category: IngestibleCategorySlug;
}

export interface UrlImportDeps {
  fetchPage: PageFetcher;
  now?: () => Date;
  /** Receives raw causes of unexpected failures, for server logs. Never shown or stored. */
  onUnexpectedError?: (context: string, error: unknown) => void;
  /** Pages fetched at the same time. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 4;
const DISPLAY_MAX = 300;

const SKIP_MESSAGES: Record<SkipReason, string> = {
  invalid_url: 'Not a valid web address. Use a full http:// or https:// URL.',
  unsafe_address: 'Not a public web address (private, local and internal addresses are never requested).',
  duplicate: 'Same URL as an earlier line in this import, so it was only fetched once.',
};

const NO_PRODUCT_MESSAGES = {
  no_product_data: 'Unable to determine product information: the page does not publish product metadata (schema.org Product or Open Graph product data).',
  no_name: 'Unable to determine product information: the page has no usable product name.',
} as const;

const SAVE_FAILED = 'The import could not be saved. Nothing was changed for this URL.';

/** Runs `task` over `items` with at most `limit` in flight. `task` must not throw. */
async function mapWithConcurrency<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

function toRow(report: ItemReport, input: string): ImportRowResult {
  const product = report.productId === undefined ? {} : { productId: report.productId };
  switch (report.outcome) {
    case 'created':
      return { input, status: 'imported', message: 'New pending product created. It stays hidden until you approve it.', ...product };
    case 'updated':
      return { input, status: 'updated', message: 'Existing offer refreshed. The product itself was not changed.', ...product };
    case 'unchanged':
      return { input, status: 'unchanged', message: 'Already current. The offer was re-checked and nothing changed.', ...product };
    case 'failed':
      return { input, status: 'failed', message: SAVE_FAILED };
    default:
      break;
  }
  switch (report.code) {
    case 'identity_conflict':
      return { input, status: 'conflict', message: report.message ?? 'This listing conflicts with an existing one. Nothing was changed.' };
    case 'duplicate':
      return { input, status: 'skipped', message: 'The same listing as another URL in this import, so it was only used once.' };
    case 'unmapped_category':
      return { input, status: 'skipped', message: 'No supported category was chosen, so no product was created.' };
    default:
      return { input, status: 'skipped', message: `Unable to determine required product information (${report.message ?? 'invalid'}).` };
  }
}

function summarize(results: readonly ImportRowResult[]): ImportSummary {
  const count = (status: ImportStatus): number => results.filter((result) => result.status === status).length;
  return {
    submitted: results.length,
    imported: count('imported'),
    updated: count('updated'),
    unchanged: count('unchanged'),
    skipped: count('skipped'),
    conflicts: count('conflict'),
    failed: count('failed'),
  };
}

interface Extracted {
  /** Position in the submitted list. */
  index: number;
  finalUrl: string;
  product: ExtractedProduct;
}

export async function runUrlImport(d1: D1Database, request: UrlImportRequest, deps: UrlImportDeps): Promise<UrlImportReport> {
  if (request.urls.length > MAX_IMPORT_URLS) throw new RangeError(`At most ${MAX_IMPORT_URLS} URLs can be imported at once.`);
  const log = deps.onUnexpectedError ?? (() => undefined);

  // 1. Normalize, reject and dedupe before any network work.
  const entries = prepareUrls(request.urls);
  const display = (input: string): string => {
    const text = cleanText(input) ?? '(empty)';
    return text.length > DISPLAY_MAX ? `${text.slice(0, DISPLAY_MAX - 1)}…` : text;
  };
  const results: (ImportRowResult | undefined)[] = entries.map((entry) =>
    entry.kind === 'skip' ? { input: display(entry.input), status: 'skipped', message: SKIP_MESSAGES[entry.reason] } : undefined,
  );

  // 2. Fetch and extract. One URL's failure is that URL's result, nothing more.
  const extracted: Extracted[] = [];
  const toFetch = entries.flatMap((entry, index) => (entry.kind === 'fetch' ? [{ index, url: entry.url, input: display(entry.input) }] : []));
  await mapWithConcurrency(toFetch, deps.concurrency ?? DEFAULT_CONCURRENCY, async ({ index, url, input }) => {
    try {
      const page = await deps.fetchPage(url);
      if (!page.ok) {
        results[index] = { input, status: 'failed', message: `Page could not be retrieved. ${page.message}` };
        return;
      }
      const outcome = extractProduct(scanHtml(page.html), page.finalUrl);
      if (!outcome.ok) {
        results[index] = { input, status: 'skipped', message: NO_PRODUCT_MESSAGES[outcome.reason] };
        return;
      }
      extracted.push({ index, finalUrl: page.finalUrl, product: outcome.product });
    } catch (error) {
      log(`fetching ${url}`, error);
      results[index] = { input, status: 'failed', message: 'Page could not be retrieved.' };
    }
  });
  extracted.sort((a, b) => a.index - b.index);

  // 3. Group by retailer and hand each group to the ingestion engine.
  if (extracted.length > 0) {
    try {
      const known = await createIngestionRepositories(d1).ingestion.listRetailers();
      const groups = new Map<string, { retailer: RetailerDescriptor; items: Extracted[] }>();
      for (const item of extracted) {
        const retailer = describeRetailer(item.finalUrl, item.product.siteName, known);
        const group = groups.get(retailer.slug) ?? { retailer, items: [] };
        group.items.push(item);
        groups.set(retailer.slug, group);
      }

      for (const { retailer, items } of groups.values()) {
        try {
          const outcome = await runIngestion(
            d1,
            createUrlImportSource({ retailer, category: request.category, products: items.map((item) => item.product) }),
            {
              ...(deps.now ? { now: deps.now } : {}),
              onUnexpectedError: log,
              onItem: (report) => {
                const item = items[report.index];
                if (item) results[item.index] = toRow(report, display(request.urls[item.index] ?? ''));
              },
            },
          );
          // A run-level failure (for example a retailer a human deactivated) reports nothing per item.
          const runFailure = outcome.issues.find((issue) => issue.code === 'run_failed');
          for (const item of items) {
            if (results[item.index] === undefined) {
              results[item.index] = { input: display(request.urls[item.index] ?? ''), status: 'failed', message: runFailure?.message ?? SAVE_FAILED };
            }
          }
        } catch (error) {
          log(`ingestion for retailer ${retailer.slug}`, error);
          for (const item of items) {
            results[item.index] ??= { input: display(request.urls[item.index] ?? ''), status: 'failed', message: SAVE_FAILED };
          }
        }
      }
    } catch (error) {
      log('preparing the import', error);
      for (const item of extracted) {
        results[item.index] ??= { input: display(request.urls[item.index] ?? ''), status: 'failed', message: SAVE_FAILED };
      }
    }
  }

  const rows = results.map((row, index) => row ?? { input: display(request.urls[index] ?? ''), status: 'failed' as const, message: SAVE_FAILED });
  return { results: rows, summary: summarize(rows) };
}
