# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher generate
one-page reading/writing practice worksheets — a short quality text paired
with an image, with dyslexia-friendly typography options (letter coloring,
syllable coloring, adjustable spacing, handwriting rulings) — and export the
result as print/PDF or an editable Word (`.docx`) file. Designed to run
entirely offline: open `index.html`, no server, no install, no internet
connection at any point.

## Status: Phase 0 (technical proof)

The current code proves the hardest single case end-to-end — one Slovene
worksheet with diacritics (`č š ž`), confused-letter coloring (b/d/p/q),
syllable coloring, a header, a bundled image, and ruled copy-practice lines —
built, measured, previewed, printed, and exported to a real, editable `.docx`,
from the actual packaged `file://` release (not a dev server).

Only 2 of the ~200+ collected Slovene texts (and none of the German/English/
French/Spanish ones) are wired in so far. Content integration, a real
settings UI, and the other languages come in later phases.

## Running it

**Just try the app** (no build needed, already built):

```
release/index.html
```

Open that file directly in a browser (double-click it, or drag it in). No
server, no internet required.

**Development:**

```bash
npm install       # one-time
npm test          # run the unit test suite
npm run build     # rebuild release/ after editing src/, styles/, or content/
```

Source content lives in `content/*.json` (one file per language, validated
against `src/content/validate.js`). The larger raw text/image collections
this content is drawn from are in `Texts collection/` and `Images/`.

## Project layout

- `src/` — application source (content validation, text styling, layout/fit
  measurement, HTML/print rendering, DOCX export)
- `styles/` — shared worksheet appearance, print stylesheet, app chrome
- `content/` — validated content packs (JSON, one per language)
- `assets/` — bundled fonts (Andika, SIL OFL) and images used by the current
  fixtures
- `scripts/build.mjs` — bundles `src/` into the self-contained `release/`
- `tests/unit/` — Node test-runner suite
