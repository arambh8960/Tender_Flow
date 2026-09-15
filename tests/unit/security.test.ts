import { describe, it, expect, vi, afterEach } from 'vitest';
import dns from 'dns/promises';

import { assertSafeUrl, classifyAddress, BlockedUrlError } from '../../server/services/security/urlGuard';
import {
  safeFileName,
  assertValidUpload,
  objectPath,
  pathBelongsToOrganization,
  checksumOf,
  MAX_DOCUMENT_BYTES,
  DocumentValidationError,
} from '../../server/services/documents/documentStorage';

/**
 * Security tests for the two places untrusted input reaches a privileged
 * operation: a caller-supplied URL that the server fetches, and a
 * caller-supplied file that the server stores.
 */

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes DNS resolve any hostname to a chosen address, for the tests below. */
function stubDns(address: string) {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }] as never);
}

describe('SSRF — blocked targets', () => {
  it('rejects localhost by name', async () => {
    await expect(assertSafeUrl('http://localhost:3001/admin')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects 127.0.0.1', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/secrets')).rejects.toThrow(/loopback/i);
  });

  it('rejects the IPv6 loopback', async () => {
    await expect(assertSafeUrl('http://[::1]/')).rejects.toThrow(/loopback/i);
  });

  it('rejects private RFC1918 ranges', async () => {
    for (const host of ['http://10.0.0.5/', 'http://192.168.1.10/', 'http://172.16.4.4/']) {
      await expect(assertSafeUrl(host)).rejects.toThrow(/private/i);
    }
  });

  it('rejects the cloud metadata address', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/link-local|metadata/i);
  });

  it('rejects metadata.google.internal by name', async () => {
    await expect(assertSafeUrl('http://metadata.google.internal/computeMetadata/v1/')).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it('rejects the file:// protocol', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(/protocol/i);
  });

  it('rejects other unsupported protocols', async () => {
    for (const url of ['ftp://example.com/x', 'gopher://example.com/', 'data:text/plain,hello']) {
      await expect(assertSafeUrl(url)).rejects.toThrow(/protocol/i);
    }
  });

  it('rejects credentials embedded in the URL', async () => {
    await expect(assertSafeUrl('https://user:pass@example.com/doc.pdf')).rejects.toThrow(/credentials/i);
  });

  it('rejects a malformed URL', async () => {
    await expect(assertSafeUrl('not a url at all')).rejects.toThrow(/malformed/i);
    await expect(assertSafeUrl('')).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('rejects a PUBLIC hostname that resolves to a private address', async () => {
    // The DNS-rebinding case: the string looks fine, the answer does not.
    stubDns('10.1.2.3');
    await expect(assertSafeUrl('https://totally-public.example.com/doc.pdf')).rejects.toThrow(/private/i);
  });

  it('rejects a hostname that resolves to the metadata address', async () => {
    stubDns('169.254.169.254');
    await expect(assertSafeUrl('https://harmless.example.com/')).rejects.toThrow(/link-local|metadata/i);
  });

  it('rejects an IPv4-mapped IPv6 loopback', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toMatch(/loopback/i);
  });

  it('rejects unique-local IPv6', () => {
    expect(classifyAddress('fd00::1')).toMatch(/unique-local/i);
  });

  it('rejects an unresolvable host', async () => {
    vi.spyOn(dns, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeUrl('https://does-not-exist.invalid/')).rejects.toThrow(/resolved/i);
  });
});

describe('SSRF — permitted targets', () => {
  it('allows a public host', async () => {
    stubDns('13.107.42.14');
    const result = await assertSafeUrl('https://bidplus.gem.gov.in/showbidDocument/123');

    expect(result.url.hostname).toBe('bidplus.gem.gov.in');
    expect(result.addresses).toEqual(['13.107.42.14']);
  });

  it('allows a literal public IP', async () => {
    const result = await assertSafeUrl('https://8.8.8.8/doc.pdf');
    expect(result.addresses).toEqual(['8.8.8.8']);
  });

  it('classifies public addresses as safe', () => {
    expect(classifyAddress('8.8.8.8')).toBeNull();
    expect(classifyAddress('2001:4860:4860::8888')).toBeNull();
  });
});

describe('file upload — filename safety', () => {
  it('strips directory traversal from a filename', () => {
    expect(safeFileName('../../../etc/passwd')).toBe('passwd');
    expect(safeFileName('..\\..\\windows\\system32\\config')).toBe('config');
    expect(safeFileName('/absolute/path/doc.pdf')).toBe('doc.pdf');
  });

  it('removes null bytes and exotic characters', () => {
    expect(safeFileName('bad\0name.pdf')).not.toContain('\0');
    expect(safeFileName('re;port&<>.pdf')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('never returns an empty name', () => {
    expect(safeFileName('')).toBe('document');
    expect(safeFileName('...')).toBe('document');
  });

  it('keeps a legitimate name intact', () => {
    expect(safeFileName('ISO-9001_2015.pdf')).toBe('ISO-9001_2015.pdf');
  });
});

describe('file upload — validation', () => {
  const file = (overrides: Partial<{ originalname: string; mimetype: string; size: number }> = {}) => ({
    originalname: 'certificate.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    ...overrides,
  });

  it('accepts a normal PDF', () => {
    expect(() => assertValidUpload(file())).not.toThrow();
  });

  it('rejects an unsupported content type', () => {
    expect(() => assertValidUpload(file({ originalname: 'evil.exe', mimetype: 'application/x-msdownload' }))).toThrow(
      DocumentValidationError
    );
  });

  it('rejects a mismatched extension even when the MIME type looks fine', () => {
    // A client sets its own Content-Type; the declared type is not evidence.
    expect(() => assertValidUpload(file({ originalname: 'payload.exe', mimetype: 'application/pdf' }))).toThrow(
      /extension/i
    );
  });

  it('rejects an oversized file', () => {
    expect(() => assertValidUpload(file({ size: MAX_DOCUMENT_BYTES + 1 }))).toThrow(/larger/i);
  });

  it('rejects an empty file', () => {
    expect(() => assertValidUpload(file({ size: 0 }))).toThrow(/empty/i);
  });
});

describe('file storage — tenant isolation', () => {
  it('prefixes every object with the owning organisation', () => {
    const path = objectPath(ORG_A, 'doc-1', 'certificate.pdf');
    expect(path).toBe(`${ORG_A}/doc-1/certificate.pdf`);
  });

  it('confirms ownership only for the matching organisation', () => {
    const path = objectPath(ORG_A, 'doc-1', 'certificate.pdf');

    expect(pathBelongsToOrganization(path, ORG_A)).toBe(true);
    expect(pathBelongsToOrganization(path, ORG_B)).toBe(false);
  });

  it('refuses a traversal attempt inside a stored path', () => {
    expect(pathBelongsToOrganization(`${ORG_A}/../${ORG_B}/doc/secret.pdf`, ORG_A)).toBe(false);
    expect(pathBelongsToOrganization(`${ORG_A}/doc\0/x.pdf`, ORG_A)).toBe(false);
  });

  it('cannot be tricked by a filename that looks like another tenant path', () => {
    const path = objectPath(ORG_A, 'doc-1', `../${ORG_B}/stolen.pdf`);
    expect(path.startsWith(`${ORG_A}/`)).toBe(true);
    expect(pathBelongsToOrganization(path, ORG_B)).toBe(false);
  });

  it('checksums content so a duplicate upload is detectable', () => {
    const a = checksumOf(Buffer.from('identical content'));
    const b = checksumOf(Buffer.from('identical content'));
    const c = checksumOf(Buffer.from('different content'));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });
});
