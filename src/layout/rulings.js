/**
 * Handwriting rulings as data. One so far: three lines (top, dashed middle,
 * solid baseline). A country's ruling (Séyès, German, Slovene) is one more
 * entry of the same shape, once real classroom samples exist.
 */

/**
 * @typedef {object} GuideLine
 * @property {'top' | 'midline' | 'baseline'} type
 * @property {number} offsetMm offset from the row's top edge
 * @property {'solid' | 'dashed'} style
 */

/**
 * @typedef {object} RulingDefinition
 * @property {string} id
 * @property {string} label
 * @property {number} lineHeightMm
 * @property {GuideLine[]} guides
 */

/**
 * @param {number} lineHeightMm
 * @returns {RulingDefinition}
 */
export function standardThreeLineRuling(lineHeightMm) {
  return {
    id: 'standard-3line',
    label: 'Standard three-line guide',
    lineHeightMm,
    guides: [
      { type: 'top', offsetMm: 0, style: 'solid' },
      { type: 'midline', offsetMm: lineHeightMm / 2, style: 'dashed' },
      { type: 'baseline', offsetMm: lineHeightMm, style: 'solid' }
    ]
  };
}

/** @type {Record<string, (lineHeightMm: number) => RulingDefinition>} */
export const RULINGS_BY_ID = {
  'standard-3line': standardThreeLineRuling
};

/**
 * @param {string} rulingId
 * @param {number} lineHeightMm
 * @returns {RulingDefinition}
 */
export function getRuling(rulingId, lineHeightMm) {
  const factory = RULINGS_BY_ID[rulingId];
  if (!factory) {
    throw new Error(`unknown rulingId "${rulingId}"`);
  }
  return factory(lineHeightMm);
}

/**
 * Full rows only — a partially clipped last row is worse than a shorter
 * copy area.
 * @param {number} availableHeightMm
 * @param {number} lineHeightMm
 * @returns {number}
 */
export function countFullRows(availableHeightMm, lineHeightMm) {
  if (lineHeightMm <= 0) return 0;
  return Math.max(0, Math.floor(availableHeightMm / lineHeightMm));
}

/**
 * @param {RulingDefinition} ruling
 * @param {number} rowCount
 * @returns {Array<{ topMm: number, guides: GuideLine[] }>}
 */
export function buildRulingRows(ruling, rowCount) {
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({ topMm: i * ruling.lineHeightMm, guides: ruling.guides });
  }
  return rows;
}
