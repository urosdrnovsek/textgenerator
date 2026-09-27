/**
 * Reading what the teacher selects: a picture, or a content pack with its
 * pictures. Browser-only (createImageBitmap, canvas), so checked in a real
 * browser by the verify scripts rather than by unit tests.
 *
 * PNG and JPEG only: an uploaded SVG could carry scripts or links.
 */

import { validatePack } from './content/validate.js';

export const IMAGE_LIMITS = {
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB per picture
  maxPixels: 16_000_000, // 16 megapixels decoded
  maxDimensionPx: 1600 // shrunk to this: a sheet shows it a few cm wide
};

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * @typedef {{ ok: true, dataUrl: string, width: number, height: number }
 *   | { ok: false, code: 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'DECODE_FAILED' | 'TOO_MANY_PIXELS' }} ImageReadResult
 */

/**
 * Checks, decodes (whatever the file claims to be, it must decode as a
 * picture), turns it upright by its EXIF orientation, shrinks it if large,
 * and returns it as a data: URL, which, unlike an object URL, outlives the
 * File.
 * @param {File} file
 * @param {typeof IMAGE_LIMITS} [limits]
 * @returns {Promise<ImageReadResult>}
 */
export async function readImageFile(file, limits = IMAGE_LIMITS) {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return { ok: false, code: 'UNSUPPORTED_TYPE' };
  }
  if (file.size > limits.maxFileSizeBytes) {
    return { ok: false, code: 'FILE_TOO_LARGE' };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, code: 'DECODE_FAILED' };
  }

  const pixelCount = bitmap.width * bitmap.height;
  if (pixelCount > limits.maxPixels) {
    bitmap.close();
    return { ok: false, code: 'TOO_MANY_PIXELS' };
  }

  const scale = Math.min(1, limits.maxDimensionPx / Math.max(bitmap.width, bitmap.height));
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, code: 'DECODE_FAILED' };
  // JPEG has no transparency: without a white ground, a clip-art PNG's
  // transparent background turns black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { ok: true, dataUrl, width: targetWidth, height: targetHeight };
}

/**
 * A selected picture's asset id: its filename without the extension
 * ("octopus.jpg" is "octopus"), the imageId a content pack refers to.
 * @param {string} filename
 * @returns {string}
 */
export function imageFilenameToAssetId(filename) {
  return filename.replace(/\.[^./\\]+$/, '');
}

/**
 * @typedef {{ ok: true, pack: import('./content/validate.js').ContentPack, images: Map<string, { id: string, path: string, width: number, height: number }> }
 *   | { ok: false, code: 'INVALID_JSON' }
 *   | { ok: false, code: 'IMAGE_READ_FAILED', imageError: { filename: string, code: string } }
 *   | { ok: false, code: 'VALIDATION_FAILED', errors: import('./content/validate.js').ValidationError[] }} ContentPackImportResult
 * images: the newly read ones, keyed by asset id
 */

/**
 * Reads a content pack and its pictures (checked like a custom picture)
 * and validates the pack against the bundled and the new pictures. All or
 * nothing: one bad picture or pack error and nothing is imported.
 * @param {File} jsonFile
 * @param {File[]} imageFiles
 * @param {Set<string>} existingAssetIds asset ids already known (bundled + previously imported)
 * @returns {Promise<ContentPackImportResult>}
 */
export async function readContentPackImport(jsonFile, imageFiles, existingAssetIds) {
  let raw;
  try {
    raw = JSON.parse(await jsonFile.text());
  } catch {
    return { ok: false, code: 'INVALID_JSON' };
  }

  const images = new Map();
  for (const file of imageFiles) {
    const result = await readImageFile(file);
    if (!result.ok) {
      return { ok: false, code: 'IMAGE_READ_FAILED', imageError: { filename: file.name, code: result.code } };
    }
    const assetId = imageFilenameToAssetId(file.name);
    images.set(assetId, { id: assetId, path: result.dataUrl, width: result.width, height: result.height });
  }

  const assetIds = new Set([...existingAssetIds, ...images.keys()]);
  const validation = validatePack(raw, assetIds);
  if (!validation.ok) {
    return { ok: false, code: 'VALIDATION_FAILED', errors: validation.errors };
  }

  return { ok: true, pack: validation.pack, images };
}
