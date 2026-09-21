/**
 * A small, strict CSV reader for the URL importer. No spreadsheet library: the input is a plain
 * text file, and the rules below are the ones that matter for "normal" CSV.
 *
 *  - fields separated by commas; rows by CRLF, LF or a lone CR
 *  - a field may be wrapped in double quotes, and then may contain commas, line breaks and
 *    `""` (an escaped quote)
 *  - a leading byte-order mark is ignored (Excel writes one)
 *
 * Malformed input is refused with a `CsvError` rather than guessed at: an unterminated quote
 * would otherwise swallow every following row into one field, and text after a closing quote
 * (`"a"b`) has no defined meaning.
 *
 * Only the URL column is used today. `parseCsvRecords` returns each row keyed by its header, so
 * an optional column (name, price, ...) can be read later without changing the parser.
 */

/** A CSV problem with a message that is safe to show the reviewer. */
export class CsvError extends Error {}

/** Splits CSV text into rows of fields. Blank lines come back as a row with one empty field. */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  if (text.includes('\u0000')) throw new CsvError('The file does not look like a text CSV.');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let closedQuote = false; // a quoted field just ended; only a separator may follow

  const endField = (): void => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = false;
        closedQuote = true;
      }
      continue;
    }

    if (char === ',') {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
    } else if (closedQuote) {
      throw new CsvError('The CSV is malformed: unexpected text after a closing quote.');
    } else if (char === '"' && field === '') {
      inQuotes = true;
    } else {
      field += char; // a quote in the middle of an unquoted field is just a character
    }
  }

  if (inQuotes) throw new CsvError('The CSV is malformed: a quoted value is never closed.');
  if (field !== '' || row.length > 0 || closedQuote) endRow(); // last row without a trailing newline
  return rows;
}

const isBlankRow = (row: readonly string[]): boolean => row.every((cell) => cell.trim() === '');

export interface CsvRecords {
  /** Header names, trimmed and lower-cased. */
  header: string[];
  /** One object per non-blank data row, keyed by header name. Values are trimmed; a short row gets `''`. */
  records: Record<string, string>[];
}

/** The header row (the first non-blank row) plus every non-blank row after it. */
export function parseCsvRecords(text: string): CsvRecords {
  const rows = parseCsv(text).filter((row) => !isBlankRow(row));
  const headerRow = rows[0];
  if (!headerRow) throw new CsvError('The CSV is empty.');

  const header = headerRow.map((cell) => cell.trim().toLowerCase());
  const records = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    header.forEach((name, column) => {
      if (name !== '' && !Object.hasOwn(record, name)) record[name] = (row[column] ?? '').trim();
    });
    return record;
  });
  return { header, records };
}

/**
 * The `url` column of a CSV, one raw string per non-blank row. A row that has other values but an
 * empty url yields `''`, which the importer reports as an invalid URL (it is never dropped silently).
 */
export function parseCsvUrls(text: string): string[] {
  const { header, records } = parseCsvRecords(text);
  if (!header.includes('url')) {
    throw new CsvError('The CSV needs a header row with a column named "url".');
  }
  return records.map((record) => record['url'] ?? '');
}
