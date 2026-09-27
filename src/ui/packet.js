/**
 * "Packet": frozen copies of sheets, listed with Add, Print and Clear, and
 * printed as one document. The list operations are worksheet/packet.js.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * `getT` is a getter: the translator changes with the interface language.
 */

import { sheetLabels } from '../i18n.js';
import { languageName } from '../languages.js';
import { renderWorksheet } from '../render/html.js';
import { printWorksheet } from '../export/print.js';
import { PACKET_MAX_SHEETS, addSnapshot, removeSnapshot, moveSnapshot, generateSnapshotId, totalPages } from '../worksheet/packet.js';

/**
 * @param {{ state: import('../main.js').AppState, els: import('./elements.js').Elements, getT: () => (key: string, vars?: object) => string, whenRendered: () => Promise<void> }} ctx
 *   whenRendered: resolves once the sheet on screen is rendered (an edit may still be measuring)
 * @returns {{ renderPacketList: () => void, updatePacketControls: () => void }}
 */
export function init({ state, els, getT, whenRendered }) {
  const t = (key, vars) => getT()(key, vars);

  /** Reflects state.packet into the sidebar list/buttons — pure DOM sync, no state changes. */
  function renderPacketList() {
    if (state.packet.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'packet-empty';
      empty.textContent = t('packet.empty');
      els.packetList.replaceChildren(empty);
      return;
    }
    els.packetList.replaceChildren(
      ...state.packet.map((sheet, index) => {
        const li = document.createElement('li');

        const titleSpan = document.createElement('span');
        titleSpan.className = 'packet-item-title';
        const pagesSuffix = sheet.pageCount > 1 ? ` — ${t('packet.sheetPages', { pages: sheet.pageCount })}` : '';
        // The activity and "Answers": a student sheet and its key are
        // otherwise two identical lines.
        const mode = t(`writingMode.${sheet.model.settings.writingMode}`);
        const key = sheet.model.blocks.some((block) => block.type === 'answerTag') ? ` — ${t('sheet.answers')}` : '';
        titleSpan.textContent = `${index + 1}. ${sheet.title} — ${languageName(sheet.language)}, ${t('field.level')} ${sheet.level} — ${mode}${key}${pagesSuffix}`;
        li.append(titleSpan);

        const upButton = document.createElement('button');
        upButton.type = 'button';
        upButton.textContent = '↑';
        upButton.title = t('action.moveUp');
        upButton.disabled = index === 0;
        upButton.addEventListener('click', () => {
          state.packet = moveSnapshot(state.packet, sheet.id, -1);
          renderPacketList();
        });
        li.append(upButton);

        const downButton = document.createElement('button');
        downButton.type = 'button';
        downButton.textContent = '↓';
        downButton.title = t('action.moveDown');
        downButton.disabled = index === state.packet.length - 1;
        downButton.addEventListener('click', () => {
          state.packet = moveSnapshot(state.packet, sheet.id, 1);
          renderPacketList();
        });
        li.append(downButton);

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.textContent = '✕';
        removeButton.title = t('action.removeFromPacket');
        removeButton.addEventListener('click', () => {
          state.packet = removeSnapshot(state.packet, sheet.id);
          updatePacketControls();
          renderPacketList();
        });
        li.append(removeButton);

        return li;
      })
    );
  }

  function updatePacketControls() {
    const pages = totalPages(state.packet);
    els.packetCount.textContent = t('packet.count', {
      count: state.packet.length,
      max: PACKET_MAX_SHEETS,
      pages
    });
    // Machine-readable, language-independent counts for the verify-* scripts
    // (same pattern as #fit-indicator's data-page-count) — parsing the
    // localized label text is how verify-firefox once mistook the sheet
    // count for the page count.
    els.packetCount.dataset.sheetCount = String(state.packet.length);
    els.packetCount.dataset.totalPages = String(pages);
    els.addToPacketButton.disabled = !state.lastGood || state.packet.length >= PACKET_MAX_SHEETS;
    els.printPacketButton.disabled = state.packet.length === 0;
    els.clearPacketButton.disabled = state.packet.length === 0;
  }

  async function handleAddToPacket() {
    await whenRendered();
    if (!state.lastGood) return;
    const { model, layout, pageCount } = state.lastGood;
    const labels = sheetLabels(t);
    const result = addSnapshot(state.packet, {
      id: generateSnapshotId(),
      title: model.title,
      language: model.contentKey.language,
      level: model.level,
      pageCount,
      model,
      layout,
      labels
    });
    if (!result.ok) {
      els.packetStatus.textContent = t('packet.full', { max: PACKET_MAX_SHEETS });
      return;
    }
    state.packet = result.packet;
    els.packetStatus.textContent = '';
    updatePacketControls();
    renderPacketList();
  }

  function handleClearPacket() {
    state.packet = [];
    updatePacketControls();
    renderPacketList();
  }

  /**
   * Prints every sheet of the packet in order, each from its frozen copy.
   * Each was print-ready when added and can't have changed, so it is drawn
   * again, not measured again.
   */
  function handlePrintPacket() {
    if (state.packet.length === 0) return;
    // Each sheet is drawn into a container already on the print surface:
    // the stripes and arcs measure real lines, and a detached node measures
    // as zero.
    els.printSurface.replaceChildren();
    for (const sheet of state.packet) {
      const container = document.createElement('div');
      els.printSurface.append(container);
      renderWorksheet(sheet.model, sheet.layout, container, sheet.labels);
      // Unwrap, so each .ws-page is a direct child of #print-surface —
      // styles/print.css's `.ws-page:last-child { break-after: auto }`
      // depends on that.
      container.replaceWith(...container.children);
    }
    // Afterwards the print surface holds the sheet on screen again, so a
    // plain "Print" (or Ctrl+P) prints that. On the browser's afterprint
    // event, not on the line after print(): Chrome and Firefox wait in
    // print() until the dialog closes, but Safari may return at once, and
    // restoring then would print the single sheet instead of the packet.
    window.addEventListener('afterprint', restoreSingleSheet, { once: true });
    printWorksheet();
  }

  function restoreSingleSheet() {
    if (state.lastGood) renderWorksheet(state.lastGood.model, state.lastGood.layout, els.printSurface, sheetLabels(t));
    else els.printSurface.replaceChildren();
  }

  els.addToPacketButton.addEventListener('click', handleAddToPacket);
  els.printPacketButton.addEventListener('click', handlePrintPacket);
  els.clearPacketButton.addEventListener('click', handleClearPacket);

  return { renderPacketList, updatePacketControls };
}
