/**
 * How reviewer input becomes the importer's URL list: manual lines, CSV, normalization,
 * de-duplication, and the address rules that stop unsafe URLs before any network work.
 * Pure functions: no network, no database.
 */
import { describe, expect, it } from 'vitest';
import { parseImportForm } from '../src/server/admin/import-form';
import { CsvError, parseCsv, parseCsvRecords, parseCsvUrls } from '../src/server/ingestion/url-import/csv';
import { MAX_IMPORT_URLS, MAX_URL_LENGTH, prepareUrls, splitUrlLines } from '../src/server/ingestion/url-import/input';
import { isPublicIpAddress, urlBlockReason } from '../src/server/ingestion/url-import/public-address';

describe('manual URL entry', () => {
  it('takes one URL per line, trims whitespace, and ignores blank lines (any line ending)', () => {
    expect(splitUrlLines('  https://a.example/1  \r\n\r\nhttps://b.example/2\n   \nhttps://c.example/3\r')).toEqual([
      'https://a.example/1',
      'https://b.example/2',
      'https://c.example/3',
    ]);
    expect(splitUrlLines('')).toEqual([]);
    expect(splitUrlLines('\n \n')).toEqual([]);
  });
});

describe('CSV parsing', () => {
  it('reads the url column with any line ending, with or without a trailing newline, and with a BOM', () => {
    const expected = ['https://a.example/1', 'https://b.example/2'];
    expect(parseCsvUrls('url\nhttps://a.example/1\nhttps://b.example/2\n')).toEqual(expected);
    expect(parseCsvUrls('url\r\nhttps://a.example/1\r\nhttps://b.example/2')).toEqual(expected);
    expect(parseCsvUrls('url\rhttps://a.example/1\rhttps://b.example/2\r')).toEqual(expected);
    expect(parseCsvUrls('﻿url\nhttps://a.example/1\nhttps://b.example/2')).toEqual(expected);
  });

  it('handles quoting: commas, escaped quotes and line breaks inside quoted values', () => {
    expect(parseCsv('a,"b,c","say ""hi""","line1\nline2"\n')).toEqual([['a', 'b,c', 'say "hi"', 'line1\nline2']]);
    expect(parseCsvUrls('url\n"https://a.example/p?x=1,2"\n')).toEqual(['https://a.example/p?x=1,2']);
    expect(parseCsv('a,,c\n')).toEqual([['a', '', 'c']]);
    expect(parseCsv('"",b\n')).toEqual([['', 'b']]); // an empty quoted value is still a value
  });

  it('ignores blank rows and trims values', () => {
    const csv = 'url\n\n  https://a.example/1  \n   \n,\n\t\nhttps://b.example/2\n\n';
    expect(parseCsvUrls(csv)).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('accepts a header in any case with extra columns in any position, and ignores the extra columns', () => {
    expect(parseCsvUrls(' Name , URL ,price\nGhost,https://a.example/1,5\nBat,https://b.example/2,7')).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ]);
  });

  it('reports a non-blank row with no url as an empty string, so it is rejected rather than silently dropped', () => {
    expect(parseCsvUrls('name,url\nGhost,\nBat,https://b.example/2')).toEqual(['', 'https://b.example/2']);
    expect(parseCsvUrls('name,url\nGhost')).toEqual(['']); // a short row
  });

  it('keeps each row keyed by its header, so optional columns can be added later without a new parser', () => {
    const { header, records } = parseCsvRecords('url,name\nhttps://a.example/1,Ghost');
    expect(header).toEqual(['url', 'name']);
    expect(records).toEqual([{ url: 'https://a.example/1', name: 'Ghost' }]);
  });

  it('refuses malformed input with a clear error instead of guessing', () => {
    const bad: Array<[string, RegExp]> = [
      ['https://a.example/1\nhttps://b.example/2\n', /header row/], // no header
      ['name\nGhost\n', /header row/], // no url column
      ['', /empty/],
      ['\n \n', /empty/],
      ['url\n"https://a.example/1\nhttps://b.example/2\n', /never closed/], // unterminated quote swallows the rest
      ['url\n"https://a.example/1"junk\n', /after a closing quote/],
      ['url\nhttps://a.example/1\u0000\n', /text CSV/], // binary content
    ];
    for (const [text, message] of bad) {
      expect(() => parseCsvUrls(text), JSON.stringify(text)).toThrow(CsvError);
      expect(() => parseCsvUrls(text), JSON.stringify(text)).toThrow(message);
    }
  });
});

describe('preparing URLs for import', () => {
  it('normalizes each URL the way ingestion does and skips exact duplicates, keeping the first', () => {
    const entries = prepareUrls([
      '  HTTPS://Shop.Example:443/Item?b=2&a=1#reviews ',
      'https://shop.example/Item?b=2&a=1', // the same URL once normalized
      'https://shop.example/Item?a=1&b=2', // different query order is a different URL: never guessed to be the same
    ]);

    expect(entries).toEqual([
      { kind: 'fetch', input: '  HTTPS://Shop.Example:443/Item?b=2&a=1#reviews ', url: 'https://shop.example/Item?b=2&a=1' },
      { kind: 'skip', input: 'https://shop.example/Item?b=2&a=1', reason: 'duplicate' },
      { kind: 'fetch', input: 'https://shop.example/Item?a=1&b=2', url: 'https://shop.example/Item?a=1&b=2' },
    ]);
  });

  it('gives the same result whether the URLs were pasted or came from a CSV', () => {
    const pasted = prepareUrls(splitUrlLines('https://a.example/1\n\nhttps://b.example/2\nhttps://a.example/1'));
    const uploaded = prepareUrls(parseCsvUrls('url\nhttps://a.example/1\n\nhttps://b.example/2\nhttps://a.example/1\n'));
    expect(uploaded).toEqual(pasted);
    expect(pasted.map((entry) => (entry.kind === 'fetch' ? 'fetch' : entry.reason))).toEqual(['fetch', 'fetch', 'duplicate']);
  });

  it('rejects malformed and non-http(s) input as invalid', () => {
    const invalid = [
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'file:///etc/passwd',
      'ftp://shop.example/x',
      'shop.example/no-scheme',
      '//shop.example/x',
      'https://',
      'https://user:secret@shop.example/x', // credentials in a URL
      'https://shop.example/has space',
      'not a url',
      '',
      `https://shop.example/${'a'.repeat(MAX_URL_LENGTH)}`,
    ];
    for (const input of invalid) {
      expect(prepareUrls([input]), input.slice(0, 40)).toEqual([{ kind: 'skip', input, reason: 'invalid_url' }]);
    }
  });

  it('rejects local, private and internal destinations as unsafe, without any lookup', () => {
    const unsafe = [
      'http://localhost/',
      'http://LOCALHOST:80/admin',
      'http://app.localhost/',
      'http://127.0.0.1/',
      'http://127.1/', // shorthand IPv4
      'http://2130706433/', // 127.0.0.1 as one integer
      'http://0x7f.0.0.1/', // hexadecimal
      'http://0177.0.0.1/', // octal
      'http://0.0.0.0/',
      'http://10.1.2.3/',
      'http://172.16.0.1/',
      'http://192.168.1.1/router',
      'http://100.64.0.1/', // carrier-grade NAT
      'http://169.254.169.254/latest/meta-data/', // cloud metadata
      'http://100.100.100.200/', // Alibaba metadata
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fe80::1]/',
      'http://[fd00:ec2::254]/', // AWS IPv6 metadata
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata/',
      'http://intranet/',
      'http://printer.local/',
      'http://nas.lan/',
      'https://shop.example:8443/', // only the standard web ports
      'http://shop.example:22/',
    ];
    for (const input of unsafe) {
      expect(prepareUrls([input]), input).toEqual([{ kind: 'skip', input, reason: 'unsafe_address' }]);
    }
  });

  it('accepts ordinary public addresses', () => {
    for (const input of ['https://shop.example/p', 'http://shop.example/p', 'https://www.shop.example/a?b=c', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/']) {
      expect(prepareUrls([input])[0]?.kind, input).toBe('fetch');
    }
  });
});

describe('public address rules', () => {
  it('treats only genuinely public IPv4 addresses as public', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.0', '100.63.255.255', '100.128.0.0']) {
      expect(isPublicIpAddress(address), address).toBe(true);
    }
    for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it('allows only global-unicast IPv6, so every private, mapped and transition spelling is refused', () => {
    for (const address of ['2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '[2606:4700:4700::1111]']) {
      expect(isPublicIpAddress(address), address).toBe(true);
    }
    for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:7f00:1::', 'ff02::1']) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it('refuses anything that is not a valid address', () => {
    for (const address of ['', 'example.com', '1.2.3', '256.1.1.1', 'fe80::1%eth0', '1:2:3:4:5:6:7:8:9', ':::', '2606:4700::zz']) {
      expect(isPublicIpAddress(address), address).toBe(false);
    }
  });

  it('checks scheme, credentials, port and host of a URL', () => {
    expect(urlBlockReason(new URL('https://shop.example/x'))).toBeUndefined();
    expect(urlBlockReason(new URL('ftp://shop.example/x'))).toBe('protocol');
    expect(urlBlockReason(new URL('https://a:b@shop.example/x'))).toBe('credentials');
    expect(urlBlockReason(new URL('https://shop.example:9000/x'))).toBe('port');
    expect(urlBlockReason(new URL('http://127.0.0.1/x'))).toBe('address');
  });
});

describe('the import form', () => {
  const form = (fields: Record<string, string | File>): FormData => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };
  const csvFile = (text: string): File => new File([text], 'urls.csv', { type: 'text/csv' });

  it('requires a valid category, because none is ever guessed', async () => {
    for (const category of [undefined, '', 'decorations', 'toys', 'INDOOR']) {
      const result = await parseImportForm(form({ urls: 'https://a.example/1', ...(category === undefined ? {} : { category }) }));
      expect(result.ok, String(category)).toBe(false);
      if (!result.ok) expect(result.invalid).toContain('category');
    }
  });

  it('turns the text area and a CSV into the same single list', async () => {
    const typed = await parseImportForm(form({ category: 'outdoor', urls: 'https://a.example/1\n\nhttps://b.example/2' }));
    const uploaded = await parseImportForm(form({ category: 'outdoor', urls: '', csv: csvFile('url\nhttps://a.example/1\n\nhttps://b.example/2\n') }));
    const both = await parseImportForm(form({ category: 'costumes', urls: 'https://a.example/1', csv: csvFile('url\nhttps://b.example/2') }));

    expect(typed).toEqual({ ok: true, category: 'outdoor', urls: ['https://a.example/1', 'https://b.example/2'] });
    expect(uploaded).toEqual(typed);
    expect(both).toEqual({ ok: true, category: 'costumes', urls: ['https://a.example/1', 'https://b.example/2'] });
  });

  it('treats an empty file input as "no file"', async () => {
    const result = await parseImportForm(form({ category: 'indoor', urls: 'https://a.example/1', csv: new File([], '') }));
    expect(result).toEqual({ ok: true, category: 'indoor', urls: ['https://a.example/1'] });
  });

  it('rejects an empty submission, a malformed CSV, and too many URLs, with messages for the reviewer', async () => {
    const empty = await parseImportForm(form({ category: 'outdoor', urls: ' \n ' }));
    expect(empty.ok).toBe(false);

    const malformed = await parseImportForm(form({ category: 'outdoor', csv: csvFile('url\n"https://a.example/1\n') }));
    expect(malformed).toMatchObject({ ok: false, invalid: ['csv'] });
    if (!malformed.ok) expect(malformed.errors.join(' ')).toMatch(/never closed/);

    const noHeader = await parseImportForm(form({ category: 'outdoor', csv: csvFile('https://a.example/1\n') }));
    expect(noHeader).toMatchObject({ ok: false, invalid: ['csv'] });

    const many = Array.from({ length: MAX_IMPORT_URLS + 1 }, (_, i) => `https://a.example/${i}`).join('\n');
    const tooMany = await parseImportForm(form({ category: 'outdoor', urls: many }));
    expect(tooMany).toMatchObject({ ok: false, invalid: ['urls'] });
  });
});
