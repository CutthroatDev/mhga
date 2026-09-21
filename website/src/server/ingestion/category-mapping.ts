/**
 * The category-mapping boundary.
 *
 * Connectors never choose or create category ROWS. The structural categories come from
 * migrations (0002); a connector only says which of the supported ones an external retailer
 * category corresponds to, and the engine resolves that slug to the existing row. A listing
 * that cannot be mapped is not given a guess: it is skipped and reported as `unmapped`.
 *
 * Supported targets are the categories a product can sit in directly: the two decoration
 * sub-categories and costumes. (The `decorations` root is a section, not a place to file a
 * product, so it is not offered.) To support more, add a migration for the category first,
 * then extend this list.
 */

export const INGESTIBLE_CATEGORY_SLUGS = ['outdoor', 'indoor', 'costumes'] as const;

export type IngestibleCategorySlug = (typeof INGESTIBLE_CATEGORY_SLUGS)[number];

export function isIngestibleCategorySlug(value: unknown): value is IngestibleCategorySlug {
  return typeof value === 'string' && (INGESTIBLE_CATEGORY_SLUGS as readonly string[]).includes(value);
}

export type CategoryMapper = (externalCategory: string | null | undefined) => IngestibleCategorySlug | undefined;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds a mapper from an explicit table of `external category -> supported slug`.
 * Matching is EXACT on the whole category text (ignoring case and extra spaces). There is no
 * substring, keyword, or similarity matching: an unknown category maps to nothing.
 */
export function createCategoryMapper(rules: Readonly<Record<string, IngestibleCategorySlug>>): CategoryMapper {
  const table = new Map<string, IngestibleCategorySlug>();
  for (const [external, slug] of Object.entries(rules)) {
    if (!isIngestibleCategorySlug(slug)) {
      throw new Error(`Category rule "${external}" targets unsupported category "${String(slug)}".`);
    }
    table.set(normalizeKey(external), slug);
  }
  return (externalCategory) => (externalCategory ? table.get(normalizeKey(externalCategory)) : undefined);
}
