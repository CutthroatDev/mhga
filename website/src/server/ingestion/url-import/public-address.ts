/**
 * What counts as a public web address, for the URL importer's server-side fetching (SSRF defence).
 *
 * The importer makes the SERVER request whatever URL a reviewer submits, so a URL must never be
 * able to reach the reviewer's own machine or network. This module is the pure policy; the
 * fetcher (safe-fetch.ts) applies it to the submitted URL, to EVERY redirect target, and to
 * every address a host name resolves to.
 *
 * Refused:
 *   - any scheme other than http: / https:, embedded credentials, ports other than 80 / 443
 *   - `localhost`, other reserved local names (`.local`, `.internal`, `.lan`, ...), and single-label
 *     names (`metadata`, `intranet`) that only mean something on an internal network
 *   - IP addresses that are not public: loopback, private (RFC 1918), CGNAT, link-local (which
 *     includes the 169.254.169.254 cloud metadata address), documentation/benchmark ranges,
 *     multicast, reserved, and every IPv6 address outside global unicast
 *
 * `new URL()` already rewrites obfuscated IPv4 hosts (`2130706433`, `0x7f.1`, `0177.0.0.1`) to
 * dotted-quad form, so the checks here see one canonical spelling.
 *
 * IPv6 is an ALLOW-list on purpose: only 2000::/3 (global unicast) qualifies, minus the special
 * purpose blocks inside it. That excludes ::1, fc00::/7, fe80::/10, IPv4-mapped (::ffff:a.b.c.d)
 * and NAT64 addresses without having to enumerate the ways to spell a private IPv4 in IPv6.
 */

const IPV4_SHAPE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** IPv4 ranges that are not public, as [base, prefix length]. */
const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], //        "this network"
  ['10.0.0.0', 8], //       private
  ['100.64.0.0', 10], //    carrier-grade NAT (includes Alibaba's metadata address)
  ['127.0.0.0', 8], //      loopback
  ['169.254.0.0', 16], //   link-local (cloud metadata)
  ['172.16.0.0', 12], //    private
  ['192.0.0.0', 24], //     IETF protocol assignments
  ['192.0.2.0', 24], //     documentation
  ['192.88.99.0', 24], //   6to4 relay (deprecated)
  ['192.168.0.0', 16], //   private
  ['198.18.0.0', 15], //    benchmarking
  ['198.51.100.0', 24], //  documentation
  ['203.0.113.0', 24], //   documentation
  ['224.0.0.0', 4], //      multicast
  ['240.0.0.0', 4], //      reserved (includes the broadcast address)
];

function parseIPv4(text: string): number[] | undefined {
  if (!IPV4_SHAPE.test(text)) return undefined;
  const parts = text.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : undefined;
}

const ipv4ToNumber = (parts: readonly number[]): number =>
  (((parts[0] as number) << 24) | ((parts[1] as number) << 16) | ((parts[2] as number) << 8) | (parts[3] as number)) >>> 0;

function isPublicIPv4(parts: readonly number[]): boolean {
  const value = ipv4ToNumber(parts);
  return !BLOCKED_IPV4.some(([base, prefix]) => {
    const baseValue = ipv4ToNumber(parseIPv4(base) as number[]);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
  });
}

/** Eight 16-bit groups, or undefined if the text is not a valid IPv6 address (zone ids are refused). */
function parseIPv6(input: string): number[] | undefined {
  let text = input.toLowerCase();
  if (text.includes('%') || !text.includes(':')) return undefined;

  // A dotted IPv4 tail (::ffff:1.2.3.4) becomes two hexadecimal groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return undefined;
    text = `${text.slice(0, lastColon + 1)}${(((v4[0] as number) << 8) | (v4[1] as number)).toString(16)}:${(((v4[2] as number) << 8) | (v4[3] as number)).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const groups = (part: string): string[] => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0] as string);
  const rest = halves.length === 2 ? groups(halves[1] as string) : [];

  let all: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return undefined;
    all = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return undefined; // "::" must stand for at least one group
    all = [...head, ...Array<string>(missing).fill('0'), ...rest];
  }
  if (!all.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return all.map((group) => parseInt(group, 16));
}

function isPublicIPv6(groups: readonly number[]): boolean {
  const first = groups[0] as number;
  const second = groups[1] as number;
  if ((first & 0xe000) !== 0x2000) return false; // not global unicast (2000::/3)
  if (first === 0x2001 && second < 0x0200) return false; // 2001::/23 IETF protocol assignments (Teredo, ...)
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  if (first === 0x2002) return false; // 6to4: embeds an IPv4 address
  if (first === 0x3fff && (second & 0xf000) === 0) return false; // documentation
  return true;
}

/** True only for a public IPv4 or IPv6 address (a URL host's brackets are accepted). Anything unparsable is false. */
export function isPublicIpAddress(address: string): boolean {
  const text = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const v4 = parseIPv4(text);
  if (v4) return isPublicIPv4(v4);
  const v6 = parseIPv6(text);
  return v6 !== undefined && isPublicIPv6(v6);
}

/** True when a URL host is an IP literal (`127.0.0.1`, `[::1]`) rather than a name. */
export function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || IPV4_SHAPE.test(hostname);
}

// Names that only exist on local or internal networks. A DNS lookup would catch most of them,
// but refusing them up front means no lookup is made for them at all.
const LOCAL_SUFFIXES = ['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'home.arpa'];
const METADATA_NAMES = new Set(['metadata.goog', 'instance-data']);

function isPublicHostName(name: string): boolean {
  const host = name.endsWith('.') ? name.slice(0, -1) : name;
  if (!host.includes('.')) return false; // single-label names are internal (search-domain) names
  if (METADATA_NAMES.has(host)) return false;
  return !LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export type UrlBlockReason = 'protocol' | 'credentials' | 'port' | 'address';

/**
 * Why a URL must not be fetched, or undefined when nothing about the URL ITSELF forbids it.
 * (A host name can still resolve to a private address; the fetcher checks that separately.)
 */
export function urlBlockReason(url: URL): UrlBlockReason | undefined {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'protocol';
  if (url.username !== '' || url.password !== '') return 'credentials';
  if (url.port !== '' && url.port !== '80' && url.port !== '443') return 'port';
  const publicHost = isIpLiteral(url.hostname) ? isPublicIpAddress(url.hostname) : isPublicHostName(url.hostname);
  return publicHost ? undefined : 'address';
}
