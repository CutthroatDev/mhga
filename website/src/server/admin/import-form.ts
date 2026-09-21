/**
 * Server-side parsing of the Import Products form. The browser attributes on the form are only a
 * convenience; everything here is re-checked and is the source of truth.
 *
 * Both input methods (the text area and the CSV upload) are reduced to the SAME list of raw
 * strings, which is handed to the same importer. Nothing here fetches anything or touches the
 * database.
 */
import { INGESTIBLE_CATEGORY_SLUGS, isIngestibleCategorySlug, type IngestibleCategorySlug } from '../ingestion/category-mapping';
import { CsvError, parseCsvUrls } from '../ingestion/url-import/csv';
import { MAX_IMPORT_URLS, splitUrlLines } from '../ingestion/url-import/input';

export const IMPORT_LIMITS = {
  /** Characters accepted in the text area. */
  textChars: 20_000,
  /** Bytes accepted in the CSV. (The whole request is also capped by `readForm`.) */
  csvBytes: 48 * 1024,
} as const;

/** What the reviewer sees for each category the importer can file a new product under. */
export const IMPORT_CATEGORY_LABELS: Record<IngestibleCategorySlug, string> = {
  outdoor: 'Outdoor decorations',
  indoor: 'Indoor decorations',
  costumes: 'Costumes',
};

export const IMPORT_CATEGORY_OPTIONS = INGESTIBLE_CATEGORY_SLUGS.map((slug) => ({ slug, label: IMPORT_CATEGORY_LABELS[slug] }));

export type ImportFormField = 'category' | 'urls' | 'csv';

export type ImportFormResult =
  | { ok: true; urls: string[]; category: IngestibleCategorySlug }
  | { ok: false; errors: string[]; invalid: ImportFormField[] };

export async function parseImportForm(form: FormData): Promise<ImportFormResult> {
  const errors: string[] = [];
  const invalid = new Set<ImportFormField>();
  const reject = (field: ImportFormField, message: string): void => {
    errors.push(message);
    invalid.add(field);
  };

  const category = form.get('category');
  if (typeof category !== 'string' || !isIngestibleCategorySlug(category)) {
    reject('category', 'Choose a category. It is applied to every NEW product in this import.');
  }

  const rawText = form.get('urls');
  const text = typeof rawText === 'string' ? rawText : '';
  const urls: string[] = [];
  if (text.length > IMPORT_LIMITS.textChars) {
    reject('urls', `The pasted list is too long (over ${IMPORT_LIMITS.textChars} characters).`);
  } else {
    urls.push(...splitUrlLines(text));
  }

  // A file input with nothing chosen still submits an empty file part, so size 0 means "no file".
  const file = form.get('csv');
  if (file instanceof File && file.size > 0) {
    if (file.size > IMPORT_LIMITS.csvBytes) {
      reject('csv', `The CSV is too large (over ${IMPORT_LIMITS.csvBytes / 1024} KB).`);
    } else {
      try {
        urls.push(...parseCsvUrls(await file.text()));
      } catch (error) {
        reject('csv', error instanceof CsvError ? error.message : 'The CSV could not be read.');
      }
    }
  }

  if (!invalid.has('urls') && !invalid.has('csv')) {
    if (urls.length === 0) reject('urls', 'Add at least one URL: paste them, one per line, or upload a CSV.');
    else if (urls.length > MAX_IMPORT_URLS) reject('urls', `That is ${urls.length} URLs. Import at most ${MAX_IMPORT_URLS} at a time.`);
  }

  if (invalid.size > 0 || typeof category !== 'string' || !isIngestibleCategorySlug(category)) {
    return { ok: false, errors, invalid: [...invalid] };
  }
  return { ok: true, urls, category };
}
