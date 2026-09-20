/**
 * Packet sidebar coordinator: the list of frozen worksheet snapshots, its
 * Add/Print/Clear buttons, and printing them as one document. Extracted
 * verbatim from main.js (0.8.1, workstream J1) — the packet data model
 * itself lives in worksheet/packet.js and stays pure.
 *
 * Takes everything through `ctx` and never imports another ui/* module.
 * `getT` is a getter because main.js reassigns its translator on every
 * language switch; holding the function itself would keep translating in
 * the startup language.
 */

import { renderWorksheet } from '../render/html.js';
import { printWorksheet } from '../export/print.js';
import { PACKET_MAX_SHEETS, addSnapshot, removeSnapshot, moveSnapshot, generateSnapshotId, totalPages } from '../worksheet/packet.js';

/**
 * @param {{ state: object, els: Record<string, HTMLElement>, getT: () => (key: string, vars?: object) => string }} ctx
 * @returns {{ renderPacketList: () => void, updatePacketControls: () => void }}
 */
export function init({ state, els, getT }) {
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
        titleSpan.textContent = `${index + 1}. ${sheet.title} — ${t(`language.${sheet.language}`)}, ${t('field.level')} ${sheet.level}${pagesSuffix}`;
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

  function handleAddToPacket() {
    if (!state.lastGood) return;
    const { model, layout, pageCount } = state.lastGood;
    const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
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
   * Prints every packet snapshot as its own page, in order. Each snapshot was
   * only ever added once it was already a print-ready worksheet, and the
   * frozen model/layout/labels can't have changed since — so there is nothing
   * left to re-measure here, only to re-render (blueprint 8.10: "Recheck
   * every sheet before printing" is satisfied by re-rendering from the
   * immutable snapshot rather than trusting stale DOM).
   */
  function handlePrintPacket() {
    if (state.packet.length === 0) return;
    const fragment = document.createDocumentFragment();
    for (const sheet of state.packet) {
      const container = document.createElement('div');
      renderWorksheet(sheet.model, sheet.layout, container, sheet.labels);
      fragment.append(...container.children);
    }
    els.printSurface.replaceChildren(fragment);
    printWorksheet();
    // Restore the print surface to the currently displayed single worksheet
    // so a subsequent plain "Print" click reflects what's on screen again.
    if (state.lastGood) {
      const labels = { nameLine: t('header.nameLine'), date: t('header.date'), pageBreak: (n) => t('preview.pageBreak', { n }) };
      renderWorksheet(state.lastGood.model, state.lastGood.layout, els.printSurface, labels);
    }
  }

  els.addToPacketButton.addEventListener('click', handleAddToPacket);
  els.printPacketButton.addEventListener('click', handlePrintPacket);
  els.clearPacketButton.addEventListener('click', handleClearPacket);

  return { renderPacketList, updatePacketControls };
}
