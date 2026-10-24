import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ApiError } from './http.js';
import { isAdminOnlySource } from './private-source-boundary.js';

// The audited 232-original archive peaks at 3,460,795 bytes. Keep a hard
// allocation bound above that maximum; do not accept arbitrary asset uploads.
export const MAX_PRIVATE_SOURCE_IMAGE_BYTES = 4 * 1024 * 1024;
const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const invalid = () => new ApiError(503, 'SOURCE_ASSET_INVALID', '原图校验未通过，请管理员核对私有归档');
const missing = () => new ApiError(404, 'SOURCE_ASSET_NOT_FOUND', '该来源没有可读取的归档原图');

export async function readPrivateSourceAsset(
  source: Record<string, unknown>,
  configuredRoot?: string,
): Promise<{ bytes: Buffer; contentType: 'image/png' | 'image/jpeg' }> {
  const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
    ? source.metadata as Record<string, unknown> : {};
  if (!isAdminOnlySource(source) || source.sourceType !== 'provided_nonofficial_image' || metadata.materialKind !== 'image_ocr') throw missing();
  if (!configuredRoot) throw new ApiError(503, 'SOURCE_ASSET_NOT_CONFIGURED', '原图归档目录尚未配置');
  if (!isAbsolute(configuredRoot) || configuredRoot.includes('\0')) throw invalid();
  const { ordinal, recordId, imageBytes, imageSha256 } = metadata;
  if (!Number.isInteger(ordinal) || Number(ordinal) < 1 || Number(ordinal) > 232 ||
    typeof recordId !== 'string' || !/^[A-Za-z0-9]{1,120}$/.test(recordId) ||
    !Number.isInteger(imageBytes) || Number(imageBytes) < 8 || Number(imageBytes) > MAX_PRIVATE_SOURCE_IMAGE_BYTES ||
    typeof imageSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(imageSha256)) throw invalid();
  const basename = `${String(ordinal).padStart(3, '0')}-${recordId}`;
  const root = resolve(configuredRoot);
  try {
    const directory = await lstat(root);
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw invalid();
    const rootReal = await realpath(root);
    // Current archive uses only .png/.jpg. Never take an extension or URL from
    // request input; ambiguous or symbolic-link candidates fail closed.
    const candidates = await Promise.all(['.png', '.jpg'].map(async extension => {
      const filename = basename + extension;
      const path = resolve(root, filename);
      try { return { filename, path, before: await lstat(path), extension }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }));
    const present = candidates.filter(candidate => candidate !== null);
    if (!present.length) throw missing();
    if (present.length !== 1) throw invalid();
    const { filename, path, before, extension } = present[0]!;
    if (before.isSymbolicLink() || !before.isFile() || before.size !== imageBytes) throw invalid();
    const fileReal = await realpath(path);
    if (dirname(fileReal) !== rootReal || fileReal !== resolve(rootReal, filename)) throw invalid();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== imageBytes) throw invalid();
      // An extra byte detects files that grow after stat without an unbounded
      // readFile allocation. Opening with NOFOLLOW closes the final-link race.
      const bytes = Buffer.alloc(Number(imageBytes) + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, length);
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      const after = await file.stat();
      if (length !== imageBytes || after.size !== imageBytes) throw invalid();
      const image = bytes.subarray(0, length);
      const isPng = image.subarray(0, 8).equals(pngMagic);
      const isJpeg = image.length >= 4 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff && image.at(-2) === 0xff && image.at(-1) === 0xd9;
      if ((extension === '.png' ? !isPng : !isJpeg) || createHash('sha256').update(image).digest('hex') !== imageSha256.toLowerCase()) throw invalid();
      return { bytes: image, contentType: isPng ? 'image/png' : 'image/jpeg' };
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw missing();
    // Never return filesystem errors containing host paths to API clients.
    throw invalid();
  }
}
