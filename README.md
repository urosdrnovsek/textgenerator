# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher generate
one-page reading/writing practice worksheets — a short quality text paired
with an image, with dyslexia-friendly typography options (letter coloring,
syllable coloring, adjustable spacing, handwriting rulings) — and export the
result as print/PDF or an editable Word (`.docx`) file. Designed to run
entirely offline: open `index.html`, no server, no install, no internet
connection at any point.

## Status: Phase 3-4 complete except country-specific rulings; Phase 5 (multi-language) functional, content unreviewed; Phase 6 (convenience) complete

- **Content:** 25 entries per language (5 themes × 5 levels) for Slovene,
  English, German, French, and Spanish — 125 entries total, all
  schema-validated (unique ids, valid image references, syllable/body
  consistency), each entry carrying a `version` (currently `1` for every
  entry across every language — see "Content versioning" below). Slovene is
  the original curated selection. **English/German/French/Spanish are
  unreviewed drafts**, drawn from `Texts collection/`: nobody has proofread
  them for a native speaker's eye, and for German (all 25 entries), French
  (20 of 25 entries), and Spanish (all 25 entries) the source material's own
  paired image didn't exist in `assets/images/`, so a topically-closest
  substitute image was manually reassigned instead — a documented stopgap,
  not a verified accurate pairing.
- **Content versioning:** every content entry carries an integer `version`
  field, currently `1` across all five languages. The intent going forward:
  `version` bumps when an entry's text is corrected after native-language
  review (not when unrelated entries are merely added), and new entries can
  be added at any time without bumping the ones already reviewed. There is
  no cross-entry "pack version" concept yet — each entry versions
  independently.
- **Language switching:** a language selector switches the active content
  pack, UI strings, `<html lang>`, and theme list at runtime, with no page
  reload — verified in a real (headless) browser: switching updates every
  static label and the theme dropdown, content and images actually change
  per language, word counts and fit-checking stay correct after a switch,
  print and `.docx` export both keep working (export filenames and,
  as of this pass, the `.docx` "Name:"/"Date:" header labels themselves
  carry the active language — a real bug caught by testing Spanish DOCX
  export end-to-end: the header had been hardcoded to Slovene labels for
  every language since Phase 0/3, now fixed and covered by a regression
  test), and a saved preset remembers and restores the language it was
  saved in.
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
  translated UI in Slovene, English, German, French, and Spanish (all five
  locale files verified to expose the identical set of string keys).
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
- **Favorites:** bookmark a content entry by `{language, contentId}` and
  jump back to it later via a Load button — a favorite whose entry no
  longer exists (e.g. after importing replacement content for that
  language) shows as "no longer available" rather than silently vanishing.
- **Packets:** assemble up to 20 worksheets — each one an immutable
  snapshot taken at "Add to packet" time, unaffected by later setting
  changes — reorder or remove sheets, then "Print packet" opens one print
  job with every sheet as its own page (verified: N sheets in the packet
  produce exactly N `.ws-page` elements in the print surface, each with
  `break-after: page` except the last, and the surface is restored to the
  single current worksheet afterward so a plain "Print" click still works).
- **Setup portability:** "Export my setups" downloads every saved preset as
  a portable `worksheet-setups.json`; "Import setups" merges one back in,
  giving a colliding id a fresh one rather than overwriting (already
  existed at the storage-module level from Phase 3; this phase wired it
  into the UI). "Reset saved data" clears only this app's own localStorage
  keys (presets + favorites) after a confirmation, never anything else in
  the browser profile.
- **Content import without coding:** a teacher (or content maintainer)
  selects a content-pack JSON file plus any new images through "Add new
  content"; the whole file is validated — including deriving each new
  image's asset id from its filename — before anything changes, and a bad
  entry blocks the entire import with the specific entry/field/message
  rather than partially merging. A successful import replaces that
  language's catalog for the rest of the session (never written back to
  `content/*.json` on disk — session-resident by design, per blueprint
  8.11). Verified end-to-end in a real browser: importing a one-entry pack
  for German actually replaces what "Create text" serves for that
  language/theme/level.
- **Teacher documentation:** `docs/teacher-guide.md` — day-to-day usage
  (worksheet creation, reading/writing supports, presets, favorites,
  packets, backup/restore, content import), written for a non-technical
  reader.

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
- `content/` — validated content packs (JSON, one per language: `sl`, `en`,
  `de`, `fr`, `es`)
- `locales/` — UI string tables, one per language (`sl`, `en`, `de`, `fr`,
  `es`), all with identical key sets (enforced by a test)
- `assets/` — bundled fonts (Andika, Lexend, OpenDyslexic, Comic Neue — all
  SIL OFL) and images referenced by `content/`, tracked in
  `assets/manifest.json`
- `scripts/build.mjs` — bundles `src/` into the self-contained `release/`;
  refuses to build if `scripts/validate-content.mjs` finds a problem
- `tests/unit/` — Node test-runner suite
- `docs/teacher-guide.md` — non-technical, day-to-day usage guide
