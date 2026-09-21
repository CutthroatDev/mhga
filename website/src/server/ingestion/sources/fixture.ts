/**
 * The controlled FIXTURE connector: a tiny, fictional retailer feed that exists to prove the
 * ingestion engine end to end. It is not a real retailer, not public product data, and it
 * makes no network requests.
 *
 * It is written the way a real feed connector would be: raw items in the retailer's own shape
 * (SKU, "sold_out", "24.99" as text, a department name), and `toCandidate` does the
 * normalization (text price -> integer cents, stock wording -> availability, department ->
 * a supported category slug). The engine sees only candidates.
 *
 * Two snapshots let a run be repeated with changes, like a retailer's feed changing over time:
 *
 *   initial   a new listing (with a bad image URL, which is dropped), two more new listings,
 *             one listing repeated in the same feed (duplicate), one with an unsafe URL
 *             (invalid), and one in a department we do not map (unmapped).
 *   updated   FX-1001 has a lower price; FX-1002 is retitled and sold out; FX-1003 is absent
 *             from the feed (it must NOT be treated as discontinued); FX-1006 is new.
 */
import type { CandidateInput } from '../candidate';
import { createCategoryMapper } from '../category-mapping';
import { parsePriceToCents } from '../price';
import type { ProductIngestionSource, RetailerDescriptor } from '../source';

/** A row of the fictional retailer's feed. */
export interface FixtureListing {
  sku: string;
  title: string;
  link: string;
  /** Text price, e.g. "24.99". */
  price?: string;
  currency?: string;
  /** The retailer's wording: in_stock | sold_out | unknown | discontinued. */
  stock?: string;
  department?: string;
  picture?: string;
  blurb?: string;
}

export type FixtureSnapshot = 'initial' | 'updated';

export const FIXTURE_SNAPSHOTS: readonly FixtureSnapshot[] = ['initial', 'updated'];

export const FIXTURE_RETAILER: RetailerDescriptor = {
  slug: 'fixture-retailer',
  name: 'Fixture Retailer',
  websiteUrl: 'https://fixture-retailer.example',
};

const SHOP = 'https://fixture-retailer.example/p';

const skeleton: FixtureListing = {
  sku: 'FX-1001',
  title: 'Fixture Glow Skeleton 5ft',
  link: `${SHOP}/glow-skeleton-5ft`,
  price: '29.99',
  currency: 'USD',
  stock: 'in_stock',
  department: 'Yard & Porch',
  picture: 'https://fixture-retailer.example/img/glow-skeleton.jpg',
  blurb: 'A fictional five-foot skeleton for the fixture feed.',
};

const garland: FixtureListing = {
  sku: 'FX-1002',
  title: 'Fixture Cobweb Garland',
  link: `${SHOP}/cobweb-garland`,
  price: '8.50',
  currency: 'USD',
  stock: 'in_stock',
  department: 'Home & Mantel',
  picture: 'javascript:alert(1)', // unsafe image URL: dropped, the product is still created
};

const witch: FixtureListing = {
  sku: 'FX-1003',
  title: 'Fixture Witch Costume (Adult)',
  link: `${SHOP}/witch-costume-adult`,
  price: '34.00',
  currency: 'USD',
  stock: 'sold_out',
  department: 'Costumes',
};

const unsafeLink: FixtureListing = {
  sku: 'FX-1004',
  title: 'Fixture Listing With Unsafe Link',
  link: 'javascript:alert(1)',
  price: '5.00',
  currency: 'USD',
  department: 'Yard & Porch',
};

const unmapped: FixtureListing = {
  sku: 'FX-1005',
  title: 'Fixture Party Balloons',
  link: `${SHOP}/party-balloons`,
  price: '3.25',
  currency: 'USD',
  stock: 'in_stock',
  department: 'Party Supplies', // not a department we map to a supported category
};

const FEEDS: Record<FixtureSnapshot, readonly FixtureListing[]> = {
  initial: [
    skeleton,
    garland,
    witch,
    { ...skeleton, price: '27.99' }, // the same SKU again in the same feed: only the first is used
    unsafeLink,
    unmapped,
  ],
  updated: [
    { ...skeleton, price: '24.99' }, // price change
    { ...garland, title: 'Fixture Cobweb Garland (2 Pack)', stock: 'sold_out' }, // retitled + availability change
    // FX-1003 is absent on purpose: missing is not discontinued.
    {
      sku: 'FX-1006',
      title: 'Fixture Hanging Bat Set',
      link: `${SHOP}/hanging-bat-set`,
      price: '12.00',
      currency: 'USD',
      stock: 'in_stock',
      department: 'Home & Mantel',
    },
    unsafeLink,
    unmapped,
  ],
};

// The retailer's department names -> supported categories. Exact matches only.
const mapDepartment = createCategoryMapper({
  'Yard & Porch': 'outdoor',
  'Home & Mantel': 'indoor',
  Costumes: 'costumes',
});

function toCandidate(item: FixtureListing): CandidateInput {
  const discontinued = item.stock === 'discontinued';
  const availability = item.stock === 'in_stock' ? 'in_stock' : item.stock === 'sold_out' ? 'out_of_stock' : undefined;
  const category = mapDepartment(item.department);

  return {
    externalId: item.sku,
    name: item.title,
    url: item.link,
    // If the text cannot be parsed, pass it on unchanged so the engine rejects the candidate
    // instead of silently treating a bad price as "no price".
    priceCents: item.price === undefined ? undefined : (parsePriceToCents(item.price) ?? item.price),
    currency: item.currency,
    availability,
    // Only an explicit statement from the source may mark a listing discontinued.
    discontinued: discontinued ? true : undefined,
    category,
    externalCategory: item.department,
    imageUrl: item.picture,
    description: item.blurb,
  };
}

export function createFixtureSource(snapshot: FixtureSnapshot = 'initial'): ProductIngestionSource<FixtureListing> {
  return {
    id: 'fixture',
    retailer: FIXTURE_RETAILER,
    fetchItems: async () => FEEDS[snapshot],
    toCandidate,
  };
}
