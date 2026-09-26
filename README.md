# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher
generate reading/writing practice worksheets: a short quality text paired
with an image, with dyslexia-friendly typography (letter coloring, syllable
coloring, adjustable spacing, handwriting rulings), exported as print/PDF
or an editable Word (`.docx`) file. It runs entirely offline — open
`index.html`; no server, no install, no internet connection at any point.

Five languages (Slovene, English, German, French, Spanish), five themes,
five difficulty levels; English has three or four texts for every theme
and level (93 entries), Slovene three (75), French, German and Spanish
two (50 each) — 318 texts in all.
Current version:
`0.9.0-rc.2` — a release candidate; see "Status" below for what's still
open.

## Quick start

```bash
npm install       # one-time
npm run build     # produces release/ (gitignored — always build locally)
```

Then open `release/index.html` in a browser (double-click it, or drag it
in). Everything the page needs is bundled inside `release/`. For day-to-day
use — making a worksheet, the reading/writing supports, saved setups,
printing a packet of several sheets, adding your own texts — read
`docs/teacher-guide.md`; it assumes no technical background.

`npm run package` produces `dist/writing-worksheet-generator-v<version>.zip`
(the release folder plus docs and license notices), which is what to hand
to a school.

## What it does

- **Pick language, theme, level; click "Create text."** The app shows a
  reviewed passage with a matching picture in a live preview; where a
  theme and level have several texts (every cell has at least two), a
  title list lets the teacher pick one, and "Create text" moves on to the
  next in order. One page is the default target; a worksheet that needs
  more says so ("will print on N pages") and stays fully
  printable/exportable rather than being blocked.
- **Reading supports, each independently switchable:** four bundled fonts
  (Andika, Lexend, OpenDyslexic, Comic Neue); font size, line, letter and
  word spacing; confused-letter colors (b/d/p/q); highlighted letter
  groups the teacher types in (up to four, such as `ch, sch, š`, colored
  and bold); syllable colors and/or
  separators; visible spaces between words (a faint `_` in each gap); one
  sentence per line; background tint and alternate-line
  stripes (both print-optional, off by default to save ink); line numbers
  down the left of the passage (in Word too, as Word's own numbering); a one-click
  Dyslexia-friendly starting point.
- **Grayscale preview:** shows the preview as a black-and-white printer
  would roughly print it (the printed sheet is unaffected). While it is on,
  a notice says when two marking colors come out almost the same grey.
- **Writing modes:** read & copy (ruled handwriting lines), trace (light
  text to trace over), read only, write about the picture (a large
  picture and ruled lines, no text), and fill the gaps (click words in the
  preview, or let the app gap every Nth word, to make a gap-fill sheet).
  The last two print a short instruction for the child, which can be
  switched off.
- **Picture on the sheet:** the text's picture, an empty drawing box after
  the text ("read it, then draw it"), or no picture.
- **Header fields** (name line, date, title), each on/off; an optional
  custom image per worksheet.
- **Export:** Print / Save as PDF (keeps the layout exactly as previewed)
  and editable `.docx` (may reflow slightly in a word processor). Both
  carry every support through the same shared text model.
- **Saved setups:** two built-in formatting presets plus teacher-saved
  setups, with export/import for moving them between computers.
- **Packets:** assemble up to 20 worksheets — each an immutable snapshot —
  reorder them, and print the set as one job.
- **Content import without coding:** a teacher can add texts by selecting
  a JSON file plus images; everything is validated before anything changes.

## Status

What's verified and how, and what still needs a real Windows machine with
Microsoft Word, real desktop browsers, and physical printers, is in
`docs/compatibility.md` — the release matrix. In short: unit tests, real
LibreOffice conversion of exported DOCX, a fresh-profile offline run in
real Chromium, and real Firefox printing are all automated and passing;
real Word, real desktop Firefox/Safari and printer tests need the
project owner's own hardware.

Still open, deliberately: a native speaker's review of the English, German,
French and Spanish content (they've had a careful editorial pass, not a
native speaker's read — 0 of 243 non-Slovene entries native-reviewed); an
image-accuracy pass over the entries whose pictures were reassigned on
topic rather than drawn for the text (209 of 318 verified, the rest
plausible, no known mismatch). Both numbers come from the per-entry review record and are
printed by `npm run content-status`, so progress is measurable rather
than asserted (see `docs/content-guide.md`). Also open: country-specific
handwriting rulings (blocked on real classroom samples); fonts are declared
but not embedded in `.docx`; zebra striping is screen/PDF only. The
project's development history is in `CHANGELOG.md`.

## Adding content

Texts live in `content/<language>.json`, one file per language, validated
by `src/content/validate.js` and gated at build time by
`scripts/validate-content.mjs`. `docs/content-guide.md` is the maintainer's
reference: the five level definitions and word bands, every entry field
and how to record a review so
`npm run content-status` can count it. The teacher-facing way to add texts
(no rebuild) is described in `docs/teacher-guide.md`; the permanent way is
to edit the JSON and run `npm run build`.

## Development

```bash
npm test                  # unit test suite (Node's built-in runner)
npm run validate-content  # content packs + asset manifest
npm run content-status    # per-language report: theme x level grid, review/native-speaker/image-accuracy counts
npm run build             # rebuild release/ after editing src/, styles/, content/ or locales/
npm run verify-docx       # real LibreOffice: exports through the real app, converts, checks page count + full text (needs soffice, poppler-utils, chromium)
npm run verify-offline    # fresh Chromium profile, network forced to fail, full journey incl. real .docx downloads
npm run verify-firefox    # real Firefox via geckodriver + selenium-webdriver, incl. real printPage() page counts
npm run package           # dist/writing-worksheet-generator-vX.Y.Z.zip
```

The three `verify-*` scripts are the real-environment gate: the project's
rule is that nothing is claimed to work until it has been run in a real
browser (and, for DOCX, a real office suite). They are developer tools,
never a teacher prerequisite.

## Project layout

- `src/` — application source: content validation/catalog, text styling,
  worksheet model, settings validation, layout/fit measurement and
  pagination, HTML/print rendering, DOCX export, storage, i18n, and
  `main.js` (state and UI wiring)
- `styles/` — shared worksheet appearance, print stylesheet, app chrome
- `content/` — validated content packs (`sl`, `en`, `de`, `fr`, `es`)
- `locales/` — UI string tables, one per language, identical key sets
  (enforced by a test)
- `assets/` — bundled fonts and images, tracked in `assets/manifest.json`
- `scripts/` — build, content validation, the three `verify-*` scripts,
  packaging
- `tests/unit/` — Node test-runner suite
- `docs/teacher-guide.md` — non-technical usage guide
- `docs/content-guide.md` — levels, entry schema, review provenance
- `docs/compatibility.md` — release matrix: what's verified, how, and
  what's still open
- `CHANGELOG.md` — development history
- `THIRD_PARTY_NOTICES.md`, `licenses/` — bundled fonts' and dependencies'
  license notices

## License

This project's own code (everything under `src/`, `styles/`, `scripts/`,
`tests/`, `index.html`, and the build tooling) is licensed under the MIT
License — see `LICENSE`.

That covers the code only. Bundled assets carry their own, separate
terms, documented in `THIRD_PARTY_NOTICES.md`:

- **Fonts** (Andika, Lexend, OpenDyslexic, Comic Neue) are each SIL Open
  Font License 1.1 — see `assets/fonts/<font>/OFL.txt`.
- **Images** in `assets/images/` are original artwork the project owner
  generated with ChatGPT (OpenAI); per `assets/manifest.json`, all rights
  are reserved by the project owner and they are bundled for use within
  this project only — not an open license, and not covered by the MIT
  grant above.
- **Content text** in `content/*.json` is original writing produced for
  this project; it is not currently released under a separate open
  license.
- The `docx` npm package (a build/runtime dependency, not part of this
  project's own code) is MIT-licensed by its own authors — see
  `licenses/docx-MIT.txt`.
