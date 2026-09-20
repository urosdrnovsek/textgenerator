/**
 * Teacher content import coordinator ("Add new content"): reads the
 * selected JSON + images through import.js, reports the first problem in
 * the teacher's language, or installs the pack as this language's catalog
 * for the rest of the session. Extracted verbatim from main.js (0.8.1,
 * workstream J1); the parsing/validation is in import.js and
 * content/validate.js.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * `getT` is a getter because main.js reassigns its translator on every
 * language switch.
 */

import { buildCatalogIndex } from '../content/catalog.js';
import { readContentPackImport } from '../import.js';

/**
 * @param {object} ctx
 * @param {object} ctx.state the single mutable app state (main.js)
 * @param {Record<string, HTMLElement>} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {Map<string, object>} ctx.imagesById the shared image registry; imported images are added to it
 * @param {(language: string, catalog: import('../content/catalog.js').CatalogIndex) => void} ctx.installCatalog
 * @param {() => void} ctx.updateCandidateCount
 */
export function init({ state, els, getT, imagesById: IMAGES_BY_ID, installCatalog, updateCandidateCount }) {
  const t = (key, vars) => getT()(key, vars);

  function describeImportError(result) {
    if (result.code === 'INVALID_JSON') return t('error.INVALID_JSON');
    if (result.code === 'IMAGE_READ_FAILED') return t('import.error.IMAGE_READ_FAILED', { filename: result.imageError.filename });
    const first = result.errors[0];
    return t('import.error.VALIDATION_FAILED', {
      count: result.errors.length,
      entryId: first.entryId,
      field: first.field,
      message: first.message
    });
  }

  /**
   * Teacher-driven content extension without coding (blueprint 8.11):
   * validates the selected JSON + any new images together, then — all or
   * nothing — replaces that language's catalog for the rest of this session.
   * Imported packs are session-resident only, never written back to disk
   * (blueprint 8.11: "Imported packs are session-resident initially").
   */
  async function handleImportContent() {
    const jsonFile = els.importJsonInput.files[0];
    if (!jsonFile) return;
    const imageFiles = [...els.importImagesInput.files];
    const result = await readContentPackImport(jsonFile, imageFiles, new Set(IMAGES_BY_ID.keys()));
    if (!result.ok) {
      els.importStatus.textContent = describeImportError(result);
      return;
    }

    for (const [id, image] of result.images) IMAGES_BY_ID.set(id, image);
    const entriesWithLanguage = result.pack.entries.map((entry) => ({ ...entry, language: result.pack.language }));
    // main.js owns the catalog bindings; if this is the active language it
    // also refreshes the theme list.
    installCatalog(result.pack.language, buildCatalogIndex(entriesWithLanguage));

    els.importStatus.textContent = t('import.success', {
      count: result.pack.entries.length,
      language: t(`language.${result.pack.language}`)
    });
    els.importJsonInput.value = '';
    els.importImagesInput.value = '';

    if (result.pack.language === state.language) {
      state.contentId = null;
      state.lastGood = null;
      els.preview.replaceChildren();
      els.printSurface.replaceChildren();
      els.printButton.disabled = true;
      els.docxButton.disabled = true;
      updateCandidateCount();
      els.fitIndicator.textContent = t('preview.empty');
    }
  }

  els.importContentButton.addEventListener('click', handleImportContent);
}
