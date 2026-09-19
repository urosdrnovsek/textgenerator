/**
 * Teacher-selected image reading, via the File API (blueprint 8.8/13).
 * Browser-only (createImageBitmap, canvas) — verified against a real
 * browser, not unit-tested the way pure modules are (same pattern as
 * layout/measure.js and render/html.js).
 *
 * Deliberately PNG/JPEG only: uploaded SVG is never accepted (blueprint 13:
 * "Only reviewed bundled SVG initially; never inline arbitrary uploaded
 * SVG" — SVG can carry scripts/external references).
 */

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
