# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher generate
one-page reading/writing practice worksheets — a short quality text paired
with an image, with dyslexia-friendly typography options (letter coloring,
syllable coloring, adjustable spacing, handwriting rulings) — and export the
result as print/PDF or an editable Word (`.docx`) file. Designed to run
entirely offline: open `index.html`, no server, no install, no internet
connection at any point.

## Status: Phase 3 in progress (Slovene pilot)

- **Content:** 25 reviewed-pending Slovene entries (5 themes × 5 levels),
  drawn from the larger collection in `Texts collection/` and `Images/`.
  German/English/French/Spanish are not wired in yet.
- **Interface:** teacher picks a theme and level, sees how many texts match,
  and clicks "Create text" to select one (never silently swapped by a filter
  change) — plus a writing-mode switch, live fit-checked preview, print/PDF,
  and editable `.docx` export. Fully in Slovene.
- **Not yet built:** font choice beyond the one bundled font (Andika),
  personalization UI, custom image/logo upload, named setup save/reload,
  country-specific handwriting rulings (only a generic 3-line guide exists).

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
- `assets/` — bundled fonts (Andika, SIL OFL) and images referenced by
  `content/`, tracked in `assets/manifest.json`
- `scripts/build.mjs` — bundles `src/` into the self-contained `release/`;
  refuses to build if `scripts/validate-content.mjs` finds a problem
- `tests/unit/` — Node test-runner suite
