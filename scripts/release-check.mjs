import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
const ignored = new Set(['node_modules', '.git', 'dist', 'coverage']);
const forbidden = /(^|\/)(data-private|data-migration|output|releases|backups|tmp)(\/|$)|(^|\/)\.env(?!\.example$)|\.(pem|key|p12|sqlite|db|dump)$/;
const secret = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}/;
const errors = []; let files = 0;
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name); const rel = relative(process.cwd(), path).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) { errors.push(`${rel}: symlink not allowed in public package`); continue; }
    if (forbidden.test(rel)) { errors.push(`${rel}: private or credential path`); continue; }
    if (entry.isDirectory()) { await walk(path); continue; }
    files++;
    if (/\.(ts|js|mjs|vue|json|md|yml|yaml|txt|html|sh)$/.test(rel)) {
      const text = await readFile(path, 'utf8');
      if (secret.test(text)) errors.push(`${rel}: possible credential`);
      if (/\/Users\/[^/]+\//.test(text)) errors.push(`${rel}: local personal path`);
    }
  }
}
await walk(process.cwd());
if(errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Public package boundary check passed: ${files} files. Manual provenance review is also required.`);
