/**
 * Teacher-selected image and content-pack reading, via the File API
 * (blueprint 8.8/8.11/13). Browser-only (createImageBitmap, canvas) —
 * verified against a real browser, not unit-tested the way pure modules
 * are (same pattern as layout/measure.js and render/html.js).
 *
 * Deliberately PNG/JPEG only: uploaded SVG is never accepted (blueprint 13:
 * "Only reviewed bundled SVG initially; never inline arbitrary uploaded
 * SVG" — SVG can carry scripts/external references).
 */

import { validatePack } from './content/validate.js';

export const IMAGE_LIMITS = {
  maxFileSizeBytes: 10 * 1024 * 1024, // blueprint 13: 10 MB per image
  maxPixels: 16_000_000, // blueprint 13: 16 megapixels decoded
  maxDimensionPx: 1600 // downsample target — the worksheet only ever displays this at a few cm wide
};

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * @typedef {object} ImageReadResult
 * @property {boolean} ok
 * @property {string} [code] one of UNSUPPORTED_TYPE, FILE_TOO_LARGE, DECODE_FAILED, TOO_MANY_PIXELS
 * @property {string} [dataUrl]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * Validates, decodes (rejecting anything that doesn't actually decode as an
 * image regardless of its claimed type/extension), normalizes EXIF
 * orientation, downsamples if oversized, and returns a data: URL — never a
 * temporary object URL, so the result survives independently of the
 * original File (blueprint 8.8: "Do not store only a temporary object URL
 * and expect it to survive reopening the app").
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
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { ok: true, dataUrl, width: targetWidth, height: targetHeight };
}

/**
 * Derives a stable asset id from a teacher-selected image filename the same
 * way the brief's author-friendly content record does ("image":
 * "octopus.jpg") — normalized to just the id validatePack()'s imageId field
 * expects (blueprint 8.11: "change its text/level/theme/image filename...
 * select that JSON plus any new images").
 * @param {string} filename
 * @returns {string}
 */
export function imageFilenameToAssetId(filename) {
  return filename.replace(/\.[^./\\]+$/, '');
}

/**
 * @typedef {object} ContentPackImportResult
 * @property {boolean} ok
 * @property {string} [code] INVALID_JSON | IMAGE_READ_FAILED | (a validatePack error code)
 * @property {{ filename: string, code: string }} [imageError] present only for IMAGE_READ_FAILED
 * @property {import('./content/validate.js').ValidationError[]} [errors] present only when pack validation itself failed
 * @property {ReturnType<typeof validatePack>['pack']} [pack]
 * @property {Map<string, { id: string, path: string }>} [images] newly read images, keyed by asset id
 */

/**
 * Reads a teacher-selected content-pack JSON file plus any accompanying
 * image files, decodes/validates the images through the same pipeline as a
 * per-worksheet custom image, derives each image's asset id from its
 * filename, and validates the whole pack against the combined (existing +
 * newly supplied) asset id set. All-or-nothing: a bad image or a pack
 * validation failure aborts the whole import rather than partially merging
 * (blueprint 8.11: "Validate everything and show a summary before
 * activating the replacement pack").
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
    images.set(imageFilenameToAssetId(file.name), { id: imageFilenameToAssetId(file.name), path: result.dataUrl });
  }

  const assetIds = new Set([...existingAssetIds, ...images.keys()]);
  const validation = validatePack(raw, assetIds);
  if (!validation.ok) {
    return { ok: false, code: 'VALIDATION_FAILED', errors: validation.errors };
  }

  return { ok: true, pack: validation.pack, images };
}
