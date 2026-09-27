/**
 * "Your own text": adding one (it goes into the theme selected now, at the
 * level its length gives, and is shown at once) and deleting the one on
 * screen. Own texts are kept in this browser (storage.js); when the browser
 * won't store them, they last for the session and the status says so.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 */

import { checkOwnText, makeOwnText } from '../content/ownText.js';
import { writeOwnTexts } from '../storage.js';

/**
 * @param {object} ctx
 * @param {import('../main.js').AppState} ctx.state
 * @param {import('./elements.js').Elements} ctx.els
 * @param {() => (key: string, vars?: object) => string} ctx.getT
 * @param {import('../content/library.js').Library} ctx.library
 * @param {() => import('../content/catalog.js').CatalogEntry | undefined} ctx.shownEntry the text on screen
 * @param {(id: string) => void} ctx.showText shows a text of the current cell by id
 * @param {() => void} ctx.showFirstOfCell after the text on screen was removed
 * @param {() => void} ctx.textsChanged the current cell's list of texts changed
 */
export function init({ state, els, getT, library, shownEntry, showText, showFirstOfCell, textsChanged }) {
  /**
   * @param {string} text
   * @param {boolean} [refused]
   */
  function say(text, refused = false) {
    els.ownStatus.classList.toggle('is-refused', refused);
    els.ownStatus.textContent = text;
  }

  function add() {
    const t = getT();
    const checked = checkOwnText({ title: els.ownTitleInput.value, body: els.ownBodyInput.value });
    if (!checked.ok) {
      say(t(`ownText.${checked.code}`), true);
      return;
    }
    const own = makeOwnText(checked, {
      id: `own_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      language: state.language,
      theme: state.filter.theme,
      picture: els.ownPictureToggle.checked
    });
    library.setOwnTexts([...library.ownTexts(), own]);
    const saved = writeOwnTexts(library.ownTexts());
    state.filter.level = own.level;
    els.themeSelect.value = own.theme;
    els.levelSelect.value = String(own.level);
    textsChanged();
    els.ownTitleInput.value = '';
    els.ownBodyInput.value = '';
    say(t(saved ? 'ownText.added' : 'ownText.addedSession', { theme: t(`theme.${own.theme}`), level: own.level }));
    showText(own.id);
  }

  function deleteShown() {
    const entry = shownEntry();
    if (!entry?.own) return;
    library.setOwnTexts(library.ownTexts().filter((own) => own.id !== entry.id));
    writeOwnTexts(library.ownTexts());
    textsChanged();
    say(getT()('ownText.deleted'));
    showFirstOfCell();
  }

  /** Only an own text can be deleted. */
  function sync() {
    els.ownDeleteButton.hidden = !shownEntry()?.own;
  }

  els.ownAddButton.addEventListener('click', add);
  els.ownDeleteButton.addEventListener('click', deleteShown);

  return { sync };
}
