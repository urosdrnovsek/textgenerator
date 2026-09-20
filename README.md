# Writing Worksheet Generator

An offline, single-page web app that lets an elementary school teacher
generate reading/writing practice worksheets — a short quality text paired
with an image, with dyslexia-friendly typography options (letter coloring,
syllable coloring, adjustable spacing, handwriting rulings) — and export the
result as print/PDF or an editable Word (`.docx`) file. One page is the
default target and what most combinations produce; a worksheet that needs
more is clearly labelled and still fully exportable (see "Multi-page
worksheets" below), rather than blocked. Designed to run entirely offline:
open `index.html`, no server, no install, no internet connection at any
point.

## Status: Phase 3-4 complete except country-specific rulings; Phase 5 (multi-language) functional; Phase 6 (convenience) complete; Phase 7 (release qualification) partially done — see below

- **Content:** 25 entries per language (5 themes × 5 levels) for Slovene,
  English, German, French, and Spanish — 125 entries total, all
  schema-validated (unique ids, valid image references, syllable/body
  consistency), each entry carrying a `version` (see "Content versioning"
  below). Slovene is the original curated selection.
  **English/German/French/Spanish have now had a close editorial pass**
  (grammar, natural phrasing, factual accuracy, syllable-break correctness
  — see `Instructions/` for the session that did this, or the git history):
  English and Spanish needed no text changes; German had 3 real
  syllable-break errors fixed (a compound-word split and two `qu`-digraph
  splits); French had 3 (a proper-noun `y`-digraph split and two instances
  of the monosyllabic word "où" incorrectly split). All 100 non-Slovene
  entries are now marked `review.status: "reviewed"`.
  **A newly-found fit problem is also now fixed:** every German and every
  French level-5 entry used to overflow the page under the app's *default*
  settings (confirmed pre-existing, not caused by the syllable fixes —
  reproduced identically against the unmodified content, via `git stash`).
  All 10 affected entries (5 DE + 5 FR) were trimmed — removing 1–3
  supplementary sentences each, keeping the core narrative/facts intact —
  and re-verified to fit in a real browser and convert to a real 1-page PDF
  via real LibreOffice; those two boundary cases are now permanent
  regression cases in `scripts/verify-docx-libreoffice.mjs`. Trimmed
  entries' versions were bumped accordingly.
  **The 4 outright-mismatched images are also now fixed:** the project
  owner generated 4 new illustrations matching the existing bundled art
  style (a castle, a red-rock monolith, moai statues, a Roman aqueduct),
  verified byte-for-byte to be the ones actually rendered for their
  entries in a real browser. Most of German (25 entries), French (18 of
  25 now), and Spanish (24 of 25) still use topically reassigned
  substitute images that are plausible but not verified accurate — that
  broader image-accuracy pass is still open, just narrower now that the
  4 clearest mismatches are gone. Image *licensing*, a separate concern,
  is resolved — see below.
- **Multi-page worksheets (0.8):** the old one-page-only hard block (a
  fitting text would export/print; anything longer was rejected outright,
  with no way forward except shrinking the text) is gone. One page is
  still the default target — most language/theme/level/settings
  combinations still produce exactly one — but a worksheet that needs more
  now reports "will print on N pages" and stays fully printable/exportable
  rather than being blocked. Page breaks are computed from the same real,
  measured content (header, title, image, every wrapped body line, and —
  in "Read & copy" mode — the handwriting-ruling area, which gets a full
  fresh page of its own if too few rows remain on the last content page)
  that both the HTML preview and the print/PDF output are built from, so
  the reported page count matches what actually prints; verified via real
  headless Chromium (`pdfinfo`/`pdftotext` against the real printed PDF)
  and real Firefox (WebDriver's own `printPage()`). DOCX export mirrors
  this: a second copy-practice table is preceded by a real Word page
  break. The screen preview also shows a dashed marker with a page number
  wherever a break is expected. A genuinely unlayoutable worksheet (an
  unbreakable word wider than the page, or a header/image/guide-height
  taller than a page on its own) is still blocked with a clear message —
  that class of failure hasn't gone away, only the "just too long"
  case has. One real, narrow Chromium print-engine bug was found and
  documented (not fixed — confirmed to be the browser engine, not this
  app, after 5 independent CSS/DOM approaches all failed identically): a
  multi-page sheet placed anywhere but last in a *packet*, followed by a
  shorter sheet, can lose its later pages when printed — see
  `docs/compatibility.md`'s Chromium known-issue section and
  `docs/teacher-guide.md`'s packet section for the practical workaround
  (put the multi-page sheet last, or print it separately).
- **Personalization default name (0.8):** a text using `{name}` (7 entries:
  4 Slovene, 3 English) used to blindly delete the placeholder when the
  teacher left the name field empty, producing broken sentences (e.g. "Was
  spending the summer..."). Every such entry now carries a required
  `name_default` (validated at import time), used automatically whenever
  the field is empty — a typed name still overrides it, exactly as typed,
  with no grammar adjustment. Fixed the related bug where syllable coloring
  was silently dropped on any personalized passage; it's now preserved
  around the substituted name in both cases. Slovene's masculine-verb-form
  entries use "Tom" as their default; the rest use "Mia".
- **Favorites removed (0.8):** the bookmark-a-text feature was removed
  (teachers weren't using it, per the project owner). Saved setups/presets
  and setup export/import are unaffected. "Reset saved data" still cleans
  up the old favorites key on a browser profile left over from a pre-0.8
  install.
- **DOCX fixes (0.8):** the exported image used to be forced into a fixed
  60×45mm box, stretching every bundled image (all 512×512 squares) into a
  4:3 shape; it's now contained at its real aspect ratio, matching the HTML
  preview, for bundled/custom/imported images alike. Word spacing
  (`extraWordSpacePt`) was silently dropped from every DOCX export; it's
  now applied to the exported space runs, same as the on-screen preview.
  A saved or imported setup with an invalid value (e.g. an unknown
  `rulingId` — hand-edited, corrupted, or from an incompatible app version)
  is now rejected with a clear message instead of throwing when applied or
  silently importing something that would later break. The settings panel
  also now exposes the header-field toggles (name line / date / title) and
  the handwriting-line-height control — both already supported by the
  underlying model and both exporters, just not previously reachable from
  the UI.
- **Image licensing:** every bundled image is original artwork the project
  owner generated with ChatGPT (OpenAI); `assets/manifest.json` and
  `THIRD_PARTY_NOTICES.md` now record this (all rights reserved by the
  project owner, bundled for this project's use — not an open license).
  See `THIRD_PARTY_NOTICES.md` for the full statement and its caveats.
- **Content versioning:** every content entry carries an integer `version`
  field. The intent going forward:
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
  keys (presets) after a confirmation, never anything else in the browser
  profile.
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
  (worksheet creation, reading/writing supports, presets,
  packets, backup/restore, content import), written for a non-technical
  reader.

### Phase 7 (release qualification): partially done

See `docs/compatibility.md` for the full release matrix — what's verified,
how, and what's still open. Summary:

- **Real LibreOffice compatibility — automated, passing.** Closes a gap
  every earlier phase explicitly flagged but never tested: the app's own
  Chromium-based fit-check doesn't run Word/LibreOffice's own layout
  engine. `npm run verify-docx` drives the real app through real headless
  Chromium to export representative `.docx` files (every language, every
  font, every writing mode, the near-max-content level-5 boundary case,
  tint, sentence-per-line, personalization), converts each through real
  headless LibreOffice, and checks the resulting PDF is exactly 1 page
  with intact text — not just that no exception was thrown.
- **Fresh-machine offline test — automated, passing.** `npm run
  verify-offline` (and its `--unzip` variant against the actual packaged
  ZIP, extracted outside the repo) launches a completely fresh Chromium
  profile with DNS resolution forced to fail, then drives a broad real
  user journey — all 5 languages, dyslexia preset, presets,
  packets, print, packet print, `.docx` export — and checks for zero
  non-`file://` network requests and zero console errors.
- **Real Firefox compatibility — automated, passing except one known Gecko
  engine issue.** Firefox doesn't speak Chrome DevTools Protocol — it
  speaks WebDriver BiDi — so `npm run verify-firefox` uses `geckodriver` +
  `selenium-webdriver` instead. Covers the same broad journey as the
  Chromium checks, plus single-worksheet and packet printing verified via
  WebDriver's real `printPage()` command (Firefox's actual print engine).
  The clean/primary flows all pass. One real, reproducible Firefox-only bug
  was found and thoroughly bisected: after enough prior settings-driven
  re-renders happen in the same tab, the *next* print can come out with
  extra blank pages — this reproduces even with a trivial, isolated repro
  and traces to Firefox's own print pagination, not this app's CSS/DOM (see
  `docs/compatibility.md` for the full writeup and a practical mitigation).
- **Versioned ZIP release — done.** `npm run package` rebuilds and
  produces `dist/writing-worksheet-generator-v<version>.zip`, bundling
  `release/` with `docs/`, `THIRD_PARTY_NOTICES.md`, and `licenses/`.
- **Font, `docx`-library, and image licenses — all resolved.** See
  `THIRD_PARTY_NOTICES.md`.
- **Still open, needs the user's own hardware/software** (none of this is
  available in the development environment this was built in): real
  Microsoft Word, real desktop Firefox/Safari, and physical printer tests.
  `docs/compatibility.md` has a concrete checklist for each.
- **Still open, deliberately not attempted here:** a native speaker's
  review of the EN/DE/FR/ES content (this pass's editorial review is
  thorough but not the same thing) and the broader (non-mismatched, just
  unverified) image-accuracy pass noted above.

Current version `0.8.0-rc.1` reflects this: a release candidate, not a
final `1.0.0` — a native-speaker content review is a real, user-facing
gap, not paperwork. (0.8 added multi-page worksheet support, a default
child name for personalized texts, and a round of DOCX/preset fixes —
see the bullets above — none of which close that particular gap.)

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
npm run verify-docx     # real LibreOffice compatibility check (needs soffice + poppler-utils)
npm run verify-offline   # fresh-profile offline/network check (needs chromium)
npm run verify-firefox   # real Firefox compatibility check (needs geckodriver)
npm run package          # produces dist/writing-worksheet-generator-vX.Y.Z.zip
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
- `scripts/verify-docx-libreoffice.mjs`, `scripts/verify-offline.mjs`,
  `scripts/verify-firefox.mjs` — Phase 7 developer/QA tools (real
  LibreOffice, fresh-profile offline, and real Firefox checks); never a
  teacher prerequisite
- `scripts/package-release.mjs` — produces the versioned distributable ZIP
- `tests/unit/` — Node test-runner suite
- `docs/teacher-guide.md` — non-technical, day-to-day usage guide
- `docs/compatibility.md` — release matrix: what's verified, how, and
  what's still open
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
