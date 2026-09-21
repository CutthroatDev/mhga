/**
 * The connector contract. The ingestion engine depends on this interface and on nothing
 * retailer-specific, so a new connector (retailer API, affiliate feed, JSON endpoint, HTML
 * scraper, CSV) is a new file that implements it. The engine's algorithm is never edited.
 *
 * Pipeline, and who owns each step:
 *
 *   fetchItems()          connector   acquire raw source items (network, files, parsing)
 *   toCandidate(item)     connector   reduce one raw item to a CandidateInput (units, prices
 *                                     to cents, retailer category -> supported slug)
 *   validateCandidate()   engine      never trusts the connector's output
 *   identity + write      engine      dedupe, create pending products, refresh offers
 *
 * What a connector must NOT do: write to the database, decide review status, invent
 * categories, or mark a listing discontinued because it was not returned. Only report
 * `discontinued: true` when the source itself says so.
 *
 * Failure semantics: if `fetchItems` throws, the run fails and NOTHING is assumed about any
 * listing (a failed fetch is not evidence that products vanished). If `toCandidate` throws for
 * one item, only that item is skipped.
 */
import type { CandidateInput } from './candidate';

/** The retailer a source reads from. Created on first use if it does not exist yet. */
export interface RetailerDescriptor {
  /** Lowercase letters, digits and hyphens: the retailer's stable identity. */
  slug: string;
  name: string;
  websiteUrl: string;
}

export interface ProductIngestionSource<RawItem = unknown> {
  /** Stable id of this source, e.g. `fixture`. Recorded on runs and offers. */
  readonly id: string;
  readonly retailer: RetailerDescriptor;
  /** Acquire the raw items. May be slow; may throw. */
  fetchItems(): Promise<readonly RawItem[]>;
  /** Normalize one raw item. Pure: no I/O. May throw for an item it cannot read. */
  toCandidate(item: RawItem): CandidateInput;
}
