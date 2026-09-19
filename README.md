# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher generate
one-page reading/writing practice worksheets — a short quality text paired
with an image, with dyslexia-friendly typography options (letter coloring,
syllable coloring, adjustable spacing, handwriting rulings) — and export the
result as print/PDF or an editable Word (`.docx`) file. Designed to run
entirely offline: open `index.html`, no server, no install, no internet
connection at any point.

## Status: Phase 3 complete; Phase 4 complete except country-specific rulings

- **Content:** 25 reviewed-pending Slovene entries (5 themes × 5 levels),
  drawn from the larger collection in `Texts collection/` and `Images/`.
  German/English/French/Spanish are not wired in yet.
- **Interface:** teacher picks a theme and level, sees how many texts match,
  and clicks "Create text" to select one (never silently swapped by a filter
  change) — plus a writing-mode switch (read & copy / trace / read only),
  dyslexia-support controls (font size, line/letter/word spacing,
  letter-color and syllable-color-or-separator toggles, a "Dyslexia-friendly"
  preset), one-sentence-per-line, a background tint (print-optional, to save
  ink by default), optional child-name personalization, an optional custom
  image upload (PNG/JPEG, validated by actually decoding it,
  EXIF-orientation-corrected, downsampled locally), live fit-checked
  preview, print/PDF, and editable `.docx` export carrying every one of
  these through (same shared styled-run model as the HTML preview). Fully
  in Slovene.
- **Named setups:** two built-in presets (Standard / Dyslexia-friendly) plus
  teacher-saved ones, persisted via localStorage with a capability check —
  save failure is reported honestly rather than claiming success. A saved
  setup never includes the child's name or a custom image (those are
  per-worksheet, not reusable).
- **Fonts:** all four brief-requested fonts bundled and selectable — Andika,
  Lexend, OpenDyslexic, Comic Neue (all SIL OFL). Each verified to have full
  glyph coverage for Slovene diacritics (č š ž, upper and lower case) by
  reading their cmap tables directly before bundling, not assumed. Not yet
  embedded in DOCX exports (font is declared by name only — Word/LibreOffice
  substitute a fallback if the font isn't installed on the machine that
  opens the file; a known, documented Phase 0 limitation, not fixed here).
- **Zebra striping:** alternate-line shading, built from real measured
  visual line boxes (`Range.getClientRects()` after layout), not a fixed
  CSS repeat — verified against actual multi-line wrapped text that the
  stripe count exactly matches the measured line count, including
  continuous alternation across sentence-per-line paragraph boundaries.
  Screen/PDF only: blueprint 8.6 is explicit that reproducing this in Word
  needs a separate "compatibility gate" (real Word, real LibreOffice, real
  content) this phase didn't attempt — everything else about a striped
  worksheet still exports correctly to `.docx`, just without the stripes.
- **Not yet built:** country-specific handwriting rulings (only a generic
  3-line guide exists — needs real teacher/classroom input, intentionally
  not fabricated; see the blueprint's decision table). This is the one
  Phase 4 item still open, and it's blocked on external input, not effort.

## Running it

```bash
npm install       # one-time
npm run build     # produces release/ (gitignored — always build locally)
```

Then open `release/index.html` directly in a browser (double-click it, or
drag it in). No server, no internet required — everything the page needs is
bundled inside `release/`.

**Development:**

```bash
npm test               # unit test suite
npm run validate-content  # validate content packs + asset manifest only
npm run build           # rebuild release/ after editing src/, styles/, or content/
```

Source content lives in `content/*.json` (one file per language, validated
against `src/content/validate.js` and gated in the build via
`scripts/validate-content.mjs`).

## Project layout

- `src/` — application source (content validation/catalog, text styling,
  settings validation, layout/fit measurement, HTML/print rendering, DOCX
  export, i18n)
- `styles/` — shared worksheet appearance, print stylesheet, app chrome
- `content/` — validated content packs (JSON, one per language)
- `locales/` — UI string tables (`sl.json` in use, `en.json` draft; `de`/`fr`
  need a native reviewer before they're added)
- `assets/` — bundled fonts (Andika, Lexend, OpenDyslexic, Comic Neue — all
  SIL OFL) and images referenced by `content/`, tracked in
  `assets/manifest.json`
- `scripts/build.mjs` — bundles `src/` into the self-contained `release/`;
  refuses to build if `scripts/validate-content.mjs` finds a problem
- `tests/unit/` — Node test-runner suite
