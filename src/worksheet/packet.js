/**
 * Pure array operations over a packet's ordered worksheet snapshots
 * (blueprint 8.10/6: "Packets contain snapshots, not live references to
 * form controls... Add, remove, reorder... Start with a conservative
 * proposed 20-sheet limit"). No DOM, no storage — main.js owns building the
 * actual snapshot objects (each one a frozen { model, layout } pair from
 * worksheet/build.js + layout/measure.js) and printing them.
 */

export const PACKET_MAX_SHEETS = 20;

/** Date.now() alone collides when two sheets are added within the same millisecond. */
export function generateSnapshotId() {
  return `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @typedef {object} PacketSnapshot
 * @property {string} id
 * @property {string} title
 * @property {string} language
 * @property {number} level
 * @property {number} pageCount how many pages this sheet prints as (upgrade blueprint v3, workstream A — a sheet is no longer guaranteed to be exactly one page)
 */

/**
 * @param {PacketSnapshot[]} packet
 * @param {PacketSnapshot} snapshot
 * @returns {{ ok: true, packet: PacketSnapshot[] } | { ok: false, code: 'PACKET_FULL' }}
 */
export function addSnapshot(packet, snapshot) {
  if (packet.length >= PACKET_MAX_SHEETS) {
    return { ok: false, code: 'PACKET_FULL' };
  }
  return { ok: true, packet: [...packet, snapshot] };
}

/**
 * @param {PacketSnapshot[]} packet
 * @param {string} id
 * @returns {PacketSnapshot[]}
 */
export function removeSnapshot(packet, id) {
  return packet.filter((sheet) => sheet.id !== id);
}

/**
 * Moves one sheet earlier (-1) or later (+1) in print order. A no-op
 * (returns an equal-by-value array) if the sheet is already at that end.
 * @param {PacketSnapshot[]} packet
 * @param {string} id
 * @param {-1 | 1} direction
 * @returns {PacketSnapshot[]}
 */
export function moveSnapshot(packet, id, direction) {
  const index = packet.findIndex((sheet) => sheet.id === id);
  const targetIndex = index + direction;
  if (index === -1 || targetIndex < 0 || targetIndex >= packet.length) {
    return packet;
  }
  const next = [...packet];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

/**
 * @param {PacketSnapshot[]} packet
 * @returns {number} total pages across every sheet — what "Print packet" actually produces
 */
export function totalPages(packet) {
  return packet.reduce((sum, sheet) => sum + sheet.pageCount, 0);
}
