import dns from 'dns/promises';
import net from 'net';

/**
 * Outbound URL guard (SSRF).
 *
 * /api/fetch-rfp-url takes a URL from the browser and fetches it from inside
 * the server's network. Without this, a caller could ask the backend to read
 * http://169.254.169.254/latest/meta-data/ (cloud credentials), an internal
 * admin panel on the VPC, or file:///etc/passwd, and receive the body back.
 *
 * The check is DNS-aware on purpose: validating the hostname string alone is
 * defeated by a public name that resolves to 127.0.0.1.
 */

export class BlockedUrlError extends Error {
  constructor(
    public reason: string,
    public target: string
  ) {
    // The message is safe to return to the caller: it names the rule, never
    // the resolved internal address.
    super(`Blocked URL: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Hostnames that are never legitimate fetch targets, regardless of DNS. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** RFC1918 + loopback + link-local + CGNAT + metadata + reserved ranges. */
const BLOCKED_V4_RANGES: Array<[string, number, string]> = [
  ['0.0.0.0', 8, 'this-network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'carrier-grade NAT'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local / cloud metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

function classifyV6(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return 'loopback';
  if (lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return 'link-local';
  }
  // fc00::/7 — unique local addresses.
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'unique-local';
  // IPv4-mapped (::ffff:127.0.0.1) must be judged by its embedded v4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return classifyV4(mapped[1]);
  return null;
}

function classifyV4(ip: string): string | null {
  for (const [base, bits, label] of BLOCKED_V4_RANGES) {
    if (inCidr(ip, base, bits)) return label;
  }
  return null;
}

/** Returns a human-readable reason when the address is not publicly routable. */
export function classifyAddress(ip: string): string | null {
  if (net.isIPv4(ip)) return classifyV4(ip);
  if (net.isIPv6(ip)) return classifyV6(ip);
  return 'unparseable address';
}

export interface SafeUrl {
  url: URL;
  /** Addresses the hostname resolved to, all of them publicly routable. */
  addresses: string[];
}

/**
 * Validates a caller-supplied URL, resolving DNS and rejecting any answer
 * that points inside the network.
 *
 * Throws BlockedUrlError; callers turn that into a 400.
 */
export async function assertSafeUrl(raw: string): Promise<SafeUrl> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BlockedUrlError('a URL is required', String(raw));
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new BlockedUrlError('the URL is malformed', raw);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError(`protocol ${url.protocol} is not allowed (http and https only)`, raw);
  }

  // Credentials in the URL are a redirect-laundering trick and are never
  // needed for a public tender document.
  if (url.username || url.password) {
    throw new BlockedUrlError('embedded credentials are not allowed', raw);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new BlockedUrlError('the URL has no host', raw);
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new BlockedUrlError(`host ${hostname} is not a permitted target`, raw);
  }
  if (hostname.endsWith('.localhost') || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new BlockedUrlError(`host ${hostname} is not a permitted target`, raw);
  }

  // A literal IP needs no DNS round trip.
  if (net.isIP(hostname)) {
    const reason = classifyAddress(hostname);
    if (reason) throw new BlockedUrlError(`address is ${reason}`, raw);
    return { url, addresses: [hostname] };
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map(r => r.address);
  } catch {
    throw new BlockedUrlError(`host ${hostname} could not be resolved`, raw);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`host ${hostname} resolved to no address`, raw);
  }

  // EVERY answer must be public. One private answer in a round-robin set is
  // enough for an attacker to win the race.
  for (const address of addresses) {
    const reason = classifyAddress(address);
    if (reason) throw new BlockedUrlError(`host resolves to a ${reason} address`, raw);
  }

  return { url, addresses };
}

/**
 * Redirect validator for the fetch layer. A redirect is a second, unchecked
 * request, so each hop is re-validated against the same rules.
 */
export async function assertSafeRedirect(location: string, from: URL): Promise<SafeUrl> {
  const absolute = new URL(location, from).toString();
  return assertSafeUrl(absolute);
}
