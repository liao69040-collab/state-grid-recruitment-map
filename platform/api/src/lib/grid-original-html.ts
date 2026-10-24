import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const GRID_ORIGINAL_SHA256 = '208c1f838eb70e7d249c536c0075426dd7028dd949c48631fdcf1908eed0981f';
export const GRID_ORIGINAL_IMAGE_URL = 'https://example.invalid/demo-illustration.svg';

export interface GridOriginalDocument {
  html: string;
  /** Send as a response header too: sandbox/frame-ancestors do not work in meta CSP. */
  csp: string;
}

function contentPolicy(html: string): { metaCsp: string; csp: string } {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== 3 || scripts.some((script) => script[1]!.trim() !== '')) {
    throw new Error('GRID_ORIGINAL_SCRIPT_STRUCTURE_MISMATCH');
  }
  const hashes = scripts.map((script) => {
    // HTML input preprocessing normalizes CRLF/CR to LF before CSP hashes script text.
    const content = script[2]!.replace(/\r\n?/g, '\n');
    return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
  });
  const metaCsp = [
    "default-src 'none'",
    `script-src ${hashes.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    // The original illustration currently returns 403/404. Preserve its URL, not a substitute.
    `img-src ${GRID_ORIGINAL_IMAGE_URL}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "font-src 'none'",
  ].join('; ') + ';';
  return { metaCsp, csp: `${metaCsp} sandbox allow-scripts; frame-ancestors 'self';` };
}

/** A version-locked, user-provided reference artifact, NOT the live roster API. */
export function prepareGridOriginalDocument(source: Buffer): GridOriginalDocument {
  if (createHash('sha256').update(source).digest('hex') !== GRID_ORIGINAL_SHA256) throw new Error('GRID_ORIGINAL_CHECKSUM_MISMATCH');
  let html = source.toString('utf8');
  // Remove the original author's contact handle in both static and drawer markup.
  // Keep the original dimensions/styles/data/interaction code otherwise intact.
  const contact = /(<div class="(?:top-contact|d-contact)">)更多信息咨询：[^<]+(<\/div>)/g;
  let replaced = 0;
  html = html.replace(contact, (_match, start, end) => { replaced++; return `${start}历史汇总参考 · 招聘要求以官方公告为准${end}`; });
  if (replaced !== 2) throw new Error('GRID_ORIGINAL_CONTACT_REDACTION_MISMATCH');
  const { metaCsp, csp } = contentPolicy(html);
  return {
    html: html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${metaCsp}">\n<meta name="referrer" content="no-referrer">`),
    csp,
  };
}

export function prepareGridOriginalHtml(source: Buffer): string {
  return prepareGridOriginalDocument(source).html;
}

export async function readGridOriginalDocument(): Promise<GridOriginalDocument> {
  // No request-controlled file paths; unreadable/mismatched files fail closed.
  const path = process.env.GRID_QUERY_ORIGINAL_HTML_PATH;
  if (!path) throw new Error('GRID_ORIGINAL_NOT_CONFIGURED');
  return prepareGridOriginalDocument(await readFile(path));
}

export async function readGridOriginalHtml(): Promise<string> {
  return (await readGridOriginalDocument()).html;
}
