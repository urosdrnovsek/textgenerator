/**
 * "Add new content": a content pack and its pictures (read by import.js)
 * replace a language's texts for this session, or the first problem is
 * reported in the teacher's language.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * `getT` is a getter: the translator changes with the interface language.
 */

import { readContentPackImport } from '../import.js';
import { languageName } from '../languages.js';

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state the single mutable app state (main.js)
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {Map<string, object>} ctx.imagesById the shared image registry; imported images are added to it
 * @param {(language: string, entries: import('../content/catalog.js').CatalogEntry[]) => void} ctx.replaceTexts a pack's texts, for this session
 * @param {() => void} ctx.updateCandidateCount
 * @param {() => void} ctx.showNoText clears the sheet, its notices and the picking controls
 */
export function init({ state, els, getT, imagesById: IMAGES_BY_ID, replaceTexts, updateCandidateCount, showNoText }) {
  const t = (key, vars) => getT()(key, vars);

  function describeImportError(result) {
    if (result.code === 'INVALID_JSON') return t('error.INVALID_JSON');
    if (result.code === 'IMAGE_READ_FAILED') return t('import.error.IMAGE_READ_FAILED', { filename: result.imageError.filename });
    // eslint-disable-next-line no-console
    console.warn('Content import refused:', result.errors);
    const first = result.errors[0];
    return t('import.error.VALIDATION_FAILED', {
      count: result.errors.length,
      where: first.entryId === '(pack)' ? t('import.where.pack') : t('import.where.entry', { id: first.entryId }),
      field: first.field,
      reason: t(`import.reason.${first.code}`)
    });
  }

  /**
   * All or nothing: the pack and its pictures are checked together, then
   * replace the language's texts until the page is closed (never saved).
   */
  async function handleImportContent() {
    const jsonFile = els.importJsonInput.files?.[0];
    if (!jsonFile) return;
    const imageFiles = [...(els.importImagesInput.files ?? [])];
    const result = await readContentPackImport(jsonFile, imageFiles, new Set(IMAGES_BY_ID.keys()));
    if (!result.ok) {
      els.importStatus.textContent = describeImportError(result);
      return;
    }

    for (const [id, image] of result.images) IMAGES_BY_ID.set(id, image);
    replaceTexts(result.pack.language, result.pack.entries.map((entry) => ({ ...entry, language: result.pack.language })));

    els.importStatus.textContent = t('import.success', {
      count: result.pack.entries.length,
      language: languageName(result.pack.language)
    });
    els.importJsonInput.value = '';
    els.importImagesInput.value = '';

    if (result.pack.language === state.language) {
      updateCandidateCount();
      showNoText();
    }
  }

  els.importContentButton.addEventListener('click', handleImportContent);
}
