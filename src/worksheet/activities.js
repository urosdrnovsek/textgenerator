/**
 * What each writing mode puts on the page — "strategy as data" (upgrade
 * blueprint §11.5.4). worksheet/build.js reads this table to decide the
 * passage variant and the task region. layout/measure.js and both
 * adapters read only the resulting model (`model.blocks`, `model.task`),
 * never the mode name, so a new activity is one row here plus whatever new
 * block it needs.
 *
 * - passage: 'text' (as styled) | 'traced' (lightened, for tracing over)
 * - task: 'lines' (ruled copy rows fill the rest of the page, the existing
 *   fit policy in layout/measure.js) | 'none'
 *
 * Pure data; no imports, so config.js can derive KNOWN_WRITING_MODES from
 * it without a cycle.
 */

/** @typedef {{ passage: 'text' | 'traced', task: 'lines' | 'none' }} Activity */

/** @type {Readonly<Record<string, Readonly<Activity>>>} */
export const ACTIVITIES = Object.freeze({
  'read-copy': Object.freeze({ passage: 'text', task: 'lines' }),
  trace: Object.freeze({ passage: 'traced', task: 'none' }),
  'read-only': Object.freeze({ passage: 'text', task: 'none' })
});
