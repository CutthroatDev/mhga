/**
 * Who the retailer is, when all we have is a product page's address.
 *
 * The identity is the site's HOST NAME, spelled in one canonical way: lower-case, no trailing
 * dot, no leading `www.`. So `www.shop.example` and `shop.example` are one retailer, and the
 * slug is derived from that (`shop-example`). Nothing else is merged: `store.shop.example` is a
 * different retailer from `shop.example` because that could genuinely be a different business.
 *
 * A retailer that already exists is reused when its website has the same host, whatever slug it
 * was given, so the importer never creates a second record for a site someone already added. If the
 * slug we would derive already belongs to a retailer for a different website, ours is made distinct.
 * (`ensureRetailer` returns an existing retailer untouched: it never renames or reactivates one.)
 */
import type { RetailerRecord } from '../../domain/catalog';
import { cleanText, shortHash, truncateAtWord } from '../text';
import type { RetailerDescriptor } from '../source';

const NAME_MAX = 100;

/** The host name in its one canonical spelling for identity purposes. */
export function siteKey(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** `shop.example` -> `shop-example`: lower-case letters, digits and hyphens only (what `retailers.slug` allows). */
export function retailerSlugForSite(key: string): string {
  const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'site' : slug;
}

function hostOf(websiteUrl: string): string | undefined {
  try {
    return siteKey(new URL(websiteUrl).hostname);
  } catch {
    return undefined;
  }
}

/**
 * The retailer for a page. `pageUrl` is the FINAL address (after redirects); `siteName` is the
 * page's own `og:site_name`, used only as the display name when a NEW retailer is created.
 */
export function describeRetailer(pageUrl: string, siteName: string | undefined, known: readonly RetailerRecord[]): RetailerDescriptor {
  const url = new URL(pageUrl);
  const key = siteKey(url.hostname);

  const sameSite = known.filter((retailer) => hostOf(retailer.websiteUrl) === key);
  if (sameSite.length === 1) {
    const [existing] = sameSite as [RetailerRecord];
    return { slug: existing.slug, name: existing.name, websiteUrl: existing.websiteUrl };
  }

  // The derived slug may already belong to a retailer for a DIFFERENT website (someone chose that slug by hand).
  // Reusing it would silently attach this site's listings to the wrong retailer, so it is made distinct.
  let slug = retailerSlugForSite(key);
  const taken = known.find((retailer) => retailer.slug === slug);
  if (taken !== undefined && hostOf(taken.websiteUrl) !== key) slug = `${slug}-${shortHash(key)}`;

  const name = cleanText(siteName);
  return {
    slug,
    name: name === undefined ? key : truncateAtWord(name, NAME_MAX),
    websiteUrl: `${url.protocol}//${url.host}`,
  };
}
