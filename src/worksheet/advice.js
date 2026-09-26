/**
 * Advisory notices: things the teacher should know about a printable
 * sheet (handbook §11.11, "Advisory"). Pure: model in, notice codes out.
 * The codes are localized at the UI edge as `notice.<CODE>`.
 *
 * Notices never block and never change the layout — a sheet that cannot
 * be laid out is a 'blocked' FitResult (layout/measure.js), not a notice.
 */

/**
 * @param {import('./build.js').WorksheetModel} model
 * @returns {string[]} notice codes, in display order; empty when there is nothing to say
 */
export function advise(model) {
  /** @type {string[]} */
  const notices = [];
  return notices;
}
