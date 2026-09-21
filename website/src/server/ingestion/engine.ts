/**
 * The ingestion engine: takes any `ProductIngestionSource` and reconciles what it observed with
 * D1. It knows nothing about retailers, HTTP, or HTML.
 *
 *   raw item -> candidate -> validate -> identity -> write
 *
 * THE RULES THIS FILE ENFORCES (each has a test in tests/ingestion.test.ts):
 *
 *  1. Never auto-approve. New products are created `pending` by the repository (a SQL literal);
 *     there is no option, flag, or parameter that changes that.
 *  2. Never touch review state or curated fields of an existing product. An observation of a
 *     known listing only refreshes the OFFER (price, currency, availability, URL, last_checked_at,
 *     and the retailer's own title as a source observation). Products are not written.
 *  3. Strong identity only. A listing is recognised by retailer + external listing id, else by
 *     retailer + exact normalized URL. There is no title matching and no cross-retailer merging:
 *     a duplicate pending product is cheap to merge later, a false merge is not.
 *  4. Idempotent. The same source run again changes nothing except freshness timestamps.
 *  5. A missing listing is NOT a discontinued listing. Nothing here ever looks for offers the
 *     source did not return. Unverified offers simply age out through the freshness policy.
 *  6. One bad candidate never aborts the run: it is reported and skipped.
 *  7. A product and its offer are created together in one batch (transaction), never one without the other.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { newId, toIso } from '../db/helpers';
import type { RetailerRecord } from '../domain/catalog';
import type {
  ExistingOffer,
  IngestionIssue,
  IngestionIssueCode,
  IngestionRunCounts,
  IngestionRunStatus,
  OfferFacts,
} from '../domain/ingestion';
import { createIngestionRepositories, type IngestionRepositories } from '../repositories';
import { MAX_PERSISTED_ISSUES } from '../repositories/ingestion';
import { validateCandidate, type IngestionCandidate } from './candidate';
import type { ProductIngestionSource } from './source';
import { shortHash, slugBase, truncateAtWord } from './text';

export interface IngestionResult extends IngestionRunCounts {
  runId: string;
  sourceId: string;
  /** `failed` means the run itself failed (source unreadable, retailer inactive): no listing was assumed to have changed. */
  status: Exclude<IngestionRunStatus, 'running'>;
  startedAt: string;
  finishedAt: string;
  /** Breakdown of `skipped`. */
  duplicates: number;
  invalid: number;
  unmapped: number;
  conflicts: number;
  /** Problems and duplicates, first few only (the counts above are always exact). */
  issues: IngestionIssue[];
  /** Everything that needs attention: all issues except harmless duplicates. Decides `partial`. */
  errorCount: number;
}

/**
 * What became of one item, reported as it is handled. For callers that must tell the user about
 * each item (the admin URL importer); the run's counts and stored issues are unaffected by it.
 */
export interface ItemReport {
  /** Position of the item in the source's list (0-based). */
  index: number;
  outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed';
  /** For `skipped` and `failed`: the engine's issue code and its safe, engine-written message. */
  code?: IngestionIssueCode;
  message?: string;
  /** The product the item belongs to (created, or already known), when there is one. */
  productId?: string;
}

export interface IngestionOptions {
  /** The clock. Injected so tests are deterministic. Default: real time. */
  now?: () => Date;
  /** Receives the raw cause of an unexpected failure, for logging. It is never stored or returned in results. */
  onUnexpectedError?: (context: string, error: unknown) => void;
  /** Called once per item after it is handled. Observing only: it cannot change what the engine does. */
  onItem?: (report: ItemReport) => void;
}

/** A run-level failure whose message is safe to show and store (no SQL, no payloads). */
export class IngestionRunError extends Error {}

/** How long a new product's initial summary may be. The reviewer is expected to rewrite it. */
const SUMMARY_MAX = 300;

/** What became of one item. */
type Outcome =
  | { kind: 'created' }
  | { kind: 'updated' }
  | { kind: 'unchanged' }
  | { kind: 'issue'; code: IngestionIssueCode; message: string };

interface Handled {
  outcome: Outcome;
  /** A short handle for the listing (its external id, else URL), when one could be read. */
  ref?: string;
  /** The product this item created or belongs to. */
  productId?: string;
}

interface RunContext<RawItem> {
  repos: IngestionRepositories;
  source: ProductIngestionSource<RawItem>;
  retailer: RetailerRecord;
  now: () => Date;
  /** Identity keys already handled in this run. */
  seen: Set<string>;
  /** Category slug -> existing category id (undefined when the row does not exist). */
  categoryIds: Map<string, string | undefined>;
}

export async function runIngestion<RawItem>(
  d1: D1Database,
  source: ProductIngestionSource<RawItem>,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const now = options.now ?? (() => new Date());
  const repos = createIngestionRepositories(d1);

  const runId = newId();
  const startedAt = toIso(now());
  // If the database is unreachable this throws: nothing can be recorded, so nothing is claimed.
  await repos.runs.start(runId, source.id, startedAt);

  const counts = { discovered: 0, productsCreated: 0, offersCreated: 0, offersUpdated: 0, offersUnchanged: 0, duplicates: 0, invalid: 0, unmapped: 0, conflicts: 0, failed: 0 };
  const issues: IngestionIssue[] = [];
  let errorCount = 0;

  const record = (issue: IngestionIssue): void => {
    if (issue.code !== 'duplicate') errorCount += 1;
    if (issues.length < MAX_PERSISTED_ISSUES) issues.push(issue);
  };

  const finish = async (status: Exclude<IngestionRunStatus, 'running'>): Promise<IngestionResult> => {
    const skipped = counts.duplicates + counts.invalid + counts.unmapped + counts.conflicts;
    const finishedAt = toIso(now());
    await repos.runs.finish(runId, {
      status,
      finishedAt,
      counts: {
        discovered: counts.discovered,
        productsCreated: counts.productsCreated,
        offersCreated: counts.offersCreated,
        offersUpdated: counts.offersUpdated,
        offersUnchanged: counts.offersUnchanged,
        skipped,
        failed: counts.failed,
      },
      issues,
      errorCount,
    });
    return { runId, sourceId: source.id, status, startedAt, finishedAt, ...counts, skipped, issues, errorCount };
  };

  try {
    const retailer = await repos.ingestion.ensureRetailer(source.retailer);
    if (!retailer.isActive) {
      throw new IngestionRunError(`Retailer "${retailer.slug}" is inactive, so nothing was ingested.`);
    }

    let items: readonly RawItem[];
    try {
      items = await source.fetchItems();
    } catch (error) {
      // A failed fetch says nothing about the listings. Fail the run and touch nothing.
      options.onUnexpectedError?.(`source "${source.id}" failed to return items`, error);
      throw new IngestionRunError(`Source "${source.id}" could not be read, so no listings were changed.`);
    }
    counts.discovered = items.length;

    const context: RunContext<RawItem> = { repos, source, retailer, now, seen: new Set(), categoryIds: new Map() };

    for (const [index, item] of items.entries()) {
      let handled: Handled;
      try {
        handled = await processItem(context, item);
      } catch (error) {
        // An unexpected failure (for example a constraint clash) skips only this candidate.
        options.onUnexpectedError?.(`candidate ${index}`, error);
        counts.failed += 1;
        const message = 'Unexpected error while saving this candidate. Nothing was written for it.';
        record({ index, code: 'write_failed', message });
        reportItem(options, { index, outcome: 'failed', code: 'write_failed', message });
        continue;
      }

      const { outcome, ref, productId } = handled;
      const withProduct = productId === undefined ? {} : { productId };
      if (outcome.kind === 'created') {
        counts.productsCreated += 1;
        counts.offersCreated += 1;
        reportItem(options, { index, outcome: 'created', ...withProduct });
      } else if (outcome.kind === 'updated') {
        counts.offersUpdated += 1;
        reportItem(options, { index, outcome: 'updated', ...withProduct });
      } else if (outcome.kind === 'unchanged') {
        counts.offersUnchanged += 1;
        reportItem(options, { index, outcome: 'unchanged', ...withProduct });
      } else {
        if (outcome.code === 'duplicate') counts.duplicates += 1;
        else if (outcome.code === 'invalid') counts.invalid += 1;
        else if (outcome.code === 'unmapped_category') counts.unmapped += 1;
        else counts.conflicts += 1;
        record({ index, code: outcome.code, message: outcome.message, ...(ref ? { ref } : {}) });
        reportItem(options, { index, outcome: 'skipped', code: outcome.code, message: outcome.message });
      }
    }

    return await finish(errorCount === 0 ? 'succeeded' : 'partial');
  } catch (error) {
    if (!(error instanceof IngestionRunError)) options.onUnexpectedError?.('run', error);
    const message = error instanceof IngestionRunError ? error.message : 'The ingestion run failed unexpectedly.';
    record({ code: 'run_failed', message });
    try {
      return await finish('failed');
    } catch (recordingError) {
      // The database is unusable, so even the failure cannot be recorded. Surface the original problem.
      options.onUnexpectedError?.('recording the failed run', recordingError);
      throw error;
    }
  }
}

/** Tells an observer about one item. A misbehaving observer must never affect the run. */
function reportItem(options: IngestionOptions, report: ItemReport): void {
  try {
    options.onItem?.(report);
  } catch (error) {
    options.onUnexpectedError?.(`onItem for candidate ${report.index}`, error);
  }
}

/** One item, from raw to outcome. Throws only for unexpected (database) failures. */
async function processItem<RawItem>(context: RunContext<RawItem>, item: RawItem): Promise<Handled> {
  const { repos, source, retailer, now } = context;

  let input: unknown;
  try {
    input = source.toCandidate(item);
  } catch {
    return { outcome: { kind: 'issue', code: 'invalid', message: 'The connector could not read this item.' } };
  }

  const validation = validateCandidate(input, { sourceId: source.id, retailerSlug: retailer.slug, now: now() });
  if (!validation.ok) {
    return { outcome: { kind: 'issue', code: 'invalid', message: validation.errors.join('; ') } };
  }
  const candidate = validation.candidate;
  const ref = candidate.externalId ?? candidate.url;

  // The same listing twice in one run: the first occurrence wins, later ones are only reported.
  const key = candidate.externalId !== undefined ? `id:${candidate.externalId}` : `url:${candidate.url}`;
  if (context.seen.has(key)) {
    return { ref, outcome: { kind: 'issue', code: 'duplicate', message: 'The source returned this listing more than once in the same run; only the first was used.' } };
  }
  context.seen.add(key);

  const identity = await resolveIdentity(repos, retailer.id, candidate);
  if (identity.kind === 'conflict') {
    return { ref, outcome: { kind: 'issue', code: 'identity_conflict', message: identity.reason } };
  }
  if (identity.kind === 'existing') {
    return { ref, productId: identity.offer.productId, outcome: await refreshExisting(repos, identity.offer, candidate) };
  }

  // A brand-new listing needs a category to become a product. It never gets an invented one.
  const categoryId = await resolveCategoryId(context, candidate);
  if (categoryId === undefined) {
    const seenCategory = candidate.externalCategory ? ` (category "${candidate.externalCategory}")` : '';
    return { ref, outcome: { kind: 'issue', code: 'unmapped_category', message: `No supported category for this listing${seenCategory}, so no product was created.` } };
  }
  const productId = await createNewProduct(repos, retailer.id, categoryId, candidate);
  return { ref, productId, outcome: { kind: 'created' } };
}

type Identity =
  | { kind: 'existing'; offer: ExistingOffer }
  | { kind: 'new' }
  | { kind: 'conflict'; reason: string };

/**
 * Strong identity only, in this order:
 *  1. retailer + external listing id
 *  2. retailer + exact normalized URL
 * When the two disagree (the URL is already another listing's), that is a conflict for a human,
 * not something to resolve by guessing.
 */
async function resolveIdentity(repos: IngestionRepositories, retailerId: string, candidate: IngestionCandidate): Promise<Identity> {
  if (candidate.externalId !== undefined) {
    const byId = await repos.ingestion.findOfferByListingId(retailerId, candidate.externalId);
    if (byId) {
      if (byId.productUrl !== candidate.url) {
        const urlOwner = await repos.ingestion.findOfferByUrl(retailerId, candidate.url);
        if (urlOwner && urlOwner.id !== byId.id) {
          return { kind: 'conflict', reason: 'This listing id is known, but its new URL already belongs to a different listing. Nothing was changed.' };
        }
      }
      return { kind: 'existing', offer: byId };
    }
  }

  const byUrl = await repos.ingestion.findOfferByUrl(retailerId, candidate.url);
  if (byUrl) {
    if (candidate.externalId !== undefined && byUrl.retailerProductId !== undefined && byUrl.retailerProductId !== candidate.externalId) {
      return { kind: 'conflict', reason: 'This URL already belongs to a listing with a different listing id. Nothing was changed.' };
    }
    return { kind: 'existing', offer: byUrl };
  }
  return { kind: 'new' };
}

/** Source-owned offer facts from a candidate. `fallbackCurrency` applies when the source gave no price. */
function offerFacts(candidate: IngestionCandidate, fallbackCurrency: string): OfferFacts {
  return {
    productUrl: candidate.url,
    priceCents: candidate.priceCents ?? null,
    currency: candidate.currency ?? fallbackCurrency,
    availability: candidate.availability,
    lastCheckedAt: candidate.observedAt,
    sourceId: candidate.sourceId,
    sourceTitle: candidate.name,
    ...(candidate.externalId !== undefined ? { retailerProductId: candidate.externalId } : {}),
  };
}

/**
 * An already-known listing was observed again: refresh the OFFER only. The product (review
 * status, notes, name, summary, category, image, ...) is never read or written here.
 */
async function refreshExisting(repos: IngestionRepositories, existing: ExistingOffer, candidate: IngestionCandidate): Promise<Outcome> {
  // An older observation (a replayed or out-of-order feed) must not overwrite a newer one.
  if (existing.lastCheckedAt && Date.parse(candidate.observedAt) < Date.parse(existing.lastCheckedAt)) {
    return { kind: 'unchanged' };
  }

  const facts = offerFacts(candidate, existing.currency);
  const changed =
    existing.productUrl !== facts.productUrl ||
    (existing.priceCents ?? null) !== facts.priceCents ||
    existing.currency !== facts.currency ||
    existing.availability !== facts.availability ||
    (facts.retailerProductId !== undefined && existing.retailerProductId === undefined) ||
    existing.sourceId !== facts.sourceId ||
    existing.sourceTitle !== facts.sourceTitle;

  // Written either way: a successful observation always refreshes last_checked_at.
  await repos.ingestion.refreshOffer(existing.id, facts);
  return { kind: changed ? 'updated' : 'unchanged' };
}

/** The existing category row for the candidate's mapped slug. Never creates one. */
async function resolveCategoryId<RawItem>(context: RunContext<RawItem>, candidate: IngestionCandidate): Promise<string | undefined> {
  if (candidate.category === undefined) return undefined;
  if (!context.categoryIds.has(candidate.category)) {
    const category = await context.repos.categories.getBySlug(candidate.category);
    context.categoryIds.set(candidate.category, category?.id);
  }
  return context.categoryIds.get(candidate.category);
}

/** Creates a PENDING product and its offer together. Source data only seeds fields of a new product. */
async function createNewProduct(repos: IngestionRepositories, retailerId: string, categoryId: string, candidate: IngestionCandidate): Promise<string> {
  const productId = newId();
  await repos.ingestion.createProductWithOffer({
    productId,
    offerId: newId(),
    slug: await uniqueSlug(repos, candidate),
    name: candidate.name,
    // A starting point for the reviewer, who is expected to write the real summary.
    summary: truncateAtWord(candidate.description ?? candidate.name, SUMMARY_MAX),
    categoryId,
    retailerId,
    offer: offerFacts(candidate, 'USD'),
    ...(candidate.imageUrl !== undefined ? { imageUrl: candidate.imageUrl } : {}),
  });
  return productId;
}

/**
 * A free product slug: the name's slug, else with a stable suffix derived from the listing
 * identity, else numbered. (The UNIQUE constraint on slug remains the backstop.)
 */
async function uniqueSlug(repos: IngestionRepositories, candidate: IngestionCandidate): Promise<string> {
  const base = slugBase(candidate.name);
  const suffixed = `${base}-${shortHash(`${candidate.retailerSlug}:${candidate.externalId ?? candidate.url}`)}`;
  const options = [base, suffixed, ...Array.from({ length: 8 }, (_, i) => `${suffixed}-${i + 2}`)];
  for (const slug of options) {
    if (!(await repos.ingestion.productSlugExists(slug))) return slug;
  }
  throw new Error('No free product slug was found.');
}
