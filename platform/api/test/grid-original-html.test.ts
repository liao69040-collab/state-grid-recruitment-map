import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GRID_ORIGINAL_IMAGE_URL,
  GRID_ORIGINAL_SHA256,
  prepareGridOriginalDocument,
  prepareGridOriginalHtml,
  readGridOriginalDocument,
} from '../src/lib/grid-original-html.js';

const fixture = process.env.GRID_QUERY_ORIGINAL_HTML_TEST_PATH
  ?? new URL('../../../../outputs/2026电网地图完善_20260922/support/html_source.html', import.meta.url);
const scripts = (html: string) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
afterEach(() => vi.unstubAllEnvs());

describe('version-locked original HTML boundary', () => {
  it('rejects any unreviewed bytes before preparing executable HTML', () => {
    expect(() => prepareGridOriginalDocument(Buffer.from('<html><script>alert(1)</script></html>')))
      .toThrow('GRID_ORIGINAL_CHECKSUM_MISMATCH');
    expect(() => prepareGridOriginalDocument(Buffer.alloc(0))).toThrow('GRID_ORIGINAL_CHECKSUM_MISMATCH');
  });

  it('fails closed when no artifact path is configured', async () => {
    vi.stubEnv('GRID_QUERY_ORIGINAL_HTML_PATH', '');
    await expect(readGridOriginalDocument()).rejects.toThrow('GRID_ORIGINAL_NOT_CONFIGURED');
  });
});

// Keep the private source out of the repository. Set the test path in deployment QA.
// This suite parses/hashes strings only; it never evaluates the source scripts or opens a browser.
describe.runIf(existsSync(fixture))('audited 2026 original HTML artifact', () => {
  const source = existsSync(fixture) ? readFileSync(fixture) : Buffer.alloc(0);

  it('verifies the exact source bytes, without changing the source buffer', () => {
    expect(source.byteLength).toBe(810435);
    expect(digest(source)).toBe(GRID_ORIGINAL_SHA256);
    prepareGridOriginalDocument(source);
    expect(digest(source)).toBe(GRID_ORIGINAL_SHA256);
  });

  it('preserves original markup/data/interaction except two redactions and security metadata', () => {
    const original = source.toString('utf8');
    const { html } = prepareGridOriginalDocument(source);
    const expected = original.replace(
      /(<div class="(?:top-contact|d-contact)">)更多信息咨询：[^<]+(<\/div>)/g,
      '$1历史汇总参考 · 招聘要求以官方公告为准$2',
    );
    expect(original.match(/更多信息咨询：/g)).toHaveLength(2);
    expect(html).not.toContain('更多信息咨询：');
    expect(html.match(/历史汇总参考 · 招聘要求以官方公告为准/g)).toHaveLength(2);
    expect(html.replace(/\n<meta http-equiv="Content-Security-Policy" content="[^"]+">\n<meta name="referrer" content="no-referrer">/, ''))
      .toBe(expected);
    expect(prepareGridOriginalHtml(source)).toBe(html);
  });

  it('allows only the three post-redaction inline script hashes, normalized as HTML parses them', () => {
    const { html, csp } = prepareGridOriginalDocument(source);
    const blocks = scripts(html);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block[1] === '')).toBe(true);
    const hashTokens = blocks.map((block) => `'sha256-${createHash('sha256')
      .update(block[2]!.replace(/\r\n?/g, '\n')).digest('base64')}'`);
    expect(csp.split('; ').find((directive) => directive.startsWith('script-src ')))
      .toBe(`script-src ${hashTokens.join(' ')}`);
    expect(hashTokens).toHaveLength(3);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("script-src-attr 'none'");
    const originalLastHash = `'sha256-${createHash('sha256').update(scripts(source.toString('utf8'))[2]![2]!
      .replace(/\r\n?/g, '\n')).digest('base64')}'`;
    expect(csp).not.toContain(originalLastHash);
  });

  it('uses opaque-origin sandbox and denies network/frames/forms except the original image', () => {
    const { html, csp } = prepareGridOriginalDocument(source);
    expect(csp).toContain('sandbox allow-scripts;');
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).toContain("frame-ancestors 'self'");
    for (const directive of ['default-src', 'connect-src', 'frame-src', 'object-src', 'base-uri', 'form-action', 'font-src']) {
      expect(csp).toContain(`${directive} 'none'`);
    }
    expect(csp).toContain(`img-src ${GRID_ORIGINAL_IMAGE_URL};`);
    expect(csp).not.toContain('data:');
    expect(html.match(/<img\b[^>]*>/gi)).toEqual([`<img src="${GRID_ORIGINAL_IMAGE_URL}" alt="电力铁塔与输电走廊插画">`]);
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    const metaPolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1]!;
    expect(metaPolicy).not.toContain('sandbox');
    expect(metaPolicy).not.toContain('frame-ancestors');
    expect(csp.startsWith(metaPolicy)).toBe(true);
  });

  it('rejects a one-byte change, extra markup, and line-ending normalization', () => {
    const changed = Buffer.from(source);
    changed[20] = changed[20]! ^ 1;
    for (const invalid of [changed, Buffer.concat([source, Buffer.from('\n')]), Buffer.from(source.toString('utf8').replace(/\r\n/g, '\n'))]) {
      expect(() => prepareGridOriginalDocument(invalid)).toThrow('GRID_ORIGINAL_CHECKSUM_MISMATCH');
    }
  });
});
