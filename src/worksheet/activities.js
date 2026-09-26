/**
 * What each writing mode puts on the page — "strategy as data" (upgrade
 * blueprint §11.5.4). worksheet/build.js reads this table to decide the
 * passage variant and the task region. layout/measure.js and both
 * adapters read only the resulting model (`model.blocks`, `model.task`),
 * never the mode name, so a new activity is one row here plus whatever new
 * block it needs.
 *
 * - passage: 'text' (as styled) | 'traced' (lightened, for tracing over)
 *   | 'hidden' (not on the sheet at all) | 'cloze' (as styled, with the
 *   words the teacher clicked turned into gaps: selection.blanks)
 * - task: 'lines' (ruled copy rows fill the rest of the page, the existing
 *   fit policy in layout/measure.js) | 'none'
 * - imageSize: 'large' for the 120 × 90 mm picture box
 *   (layout/imageBox.js); absent = the normal 60 × 45 mm one
 * - copyTarget: true when the teacher may choose what to copy
 *   (settings.copyTarget); only read & copy has copy lines to fill
 * - instruction: the key of the line printed under the title for the
 *   child (locale `sheet.instruction.<key>`); absent = no line, so the
 *   older modes print exactly as they always have
 *
 * Pure data; no imports, so config.js can derive KNOWN_WRITING_MODES from
 * it without a cycle.
 */

/** @typedef {{ passage: 'text' | 'traced' | 'hidden' | 'cloze', task: 'lines' | 'none', imageSize?: 'large', instruction?: string, copyTarget?: true }} Activity */

/** @type {Readonly<Record<string, Readonly<Activity>>>} */
export const ACTIVITIES = Object.freeze({
  'read-copy': Object.freeze({ passage: 'text', task: 'lines', copyTarget: true }),
  trace: Object.freeze({ passage: 'traced', task: 'none' }),
  'read-only': Object.freeze({ passage: 'text', task: 'none' }),
  'write-own': Object.freeze({ passage: 'hidden', task: 'lines', imageSize: 'large', instruction: 'write-own' }),
  cloze: Object.freeze({ passage: 'cloze', task: 'none', instruction: 'cloze' })
});
