/**
 * Which passage paragraphs a copy mark (handbook §11.6 A3) covers
 * completely. The Word file can only mark a whole paragraph (a left
 * border); a target that covers part of one is marked in the preview and
 * print only, and advice.js says so (DOCX_OMITS_COPY_MARK). Pure.
 */

/**
 * @param {{ paragraphs: import('../text/runs.js').StyledRun[][], copyMark: { firstW: number, lastW: number } | null }} passage
 * @returns {{ whole: Set<number>, partial: boolean }} indices of the paragraphs whose every word is in the target; partial: some target word sits in a paragraph that is only partly marked
 */
export function markedParagraphs(passage) {
  const whole = new Set();
  let partial = false;
  if (!passage.copyMark) return { whole, partial };
  const { firstW, lastW } = passage.copyMark;
  passage.paragraphs.forEach((runs, i) => {
    const words = runs.filter((r) => r.w !== undefined).map((r) => r.w);
    const inside = words.filter((w) => w >= firstW && w <= lastW);
    if (inside.length === 0) return;
    if (inside.length === words.length) whole.add(i);
    else partial = true;
  });
  return { whole, partial };
}
