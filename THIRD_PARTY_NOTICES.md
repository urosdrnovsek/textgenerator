# Third-party notices

This application bundles the following third-party software and fonts.
Each is redistributed under its own license, reproduced in full at the
path listed. This file covers what actually ships inside `release/`
(the code and fonts a teacher's computer receives) — build-only tooling
that never ships (esbuild, Node's test runner) is not included here.

## Fonts

All four bundled fonts are licensed under the SIL Open Font License,
Version 1.1 — free to embed, redistribute, and use, including in this
offline release, without royalty. Full license text is bundled alongside
each font's files, at `assets/fonts/<font>/OFL.txt` (also mirrored below
for convenience). None of the Reserved Font Names below ("Andika", "SIL",
"OpenDyslexic") are used as this application's own name, per each
license's own restriction on that point.

| Font | Copyright | Reserved Font Name(s) | License file |
| --- | --- | --- | --- |
| Andika | (c) 2004–2025 SIL Global (https://www.sil.org/) | Andika, SIL | `assets/fonts/andika/OFL.txt` |
| Lexend | (c) 2018 The Lexend Project Authors (https://github.com/googlefonts/lexend) | "RevReading Lexend" | `assets/fonts/lexend/OFL.txt` |
| OpenDyslexic | (c) 2019 Abbie Gonzalez (https://abbiecod.es) and (c) 2012–2019 prior contributors | OpenDyslexic | `assets/fonts/opendyslexic/OFL.txt` |
| Comic Neue | (c) 2014 The Comic Neue Project Authors (https://github.com/crozynski/comicneue) | (none asserted) | `assets/fonts/comicneue/OFL.txt` |

Font glyph coverage for every bundled language's diacritics (Slovene č š
ž, German ä ö ü ß, French é è ê ç à â, Spanish ñ á é í ó ú ü ¿ ¡) was
verified directly against each font file's cmap table before bundling —
see the commit history for the from-scratch TTF/OTF cmap parser used,
since `fontTools` is not available in this project's development
environment.

Known limitation, documented since Phase 0: these fonts are *declared* by
name in exported `.docx` files but not embedded in the OOXML — Word and
LibreOffice substitute their own fallback font if the chosen one isn't
already installed on the machine that opens the file. PDF/print output is
unaffected; it always uses the correct embedded rendering.

## Software

| Package | Version | License | License file |
| --- | --- | --- | --- |
| `docx` (dolanmiu/docx) | ^9.5.1 | MIT | `licenses/docx-MIT.txt` |

`docx` is the only runtime dependency bundled into `release/app.js` (via
`npm run build`'s esbuild step). No other npm package ships in the
release — esbuild itself is a build-time-only tool and does not inject
runtime code into the output beyond the application's own bundled source
and `docx`.

## Images

Every image currently bundled in `assets/images/` is listed in
`assets/manifest.json` with `"license": "unreviewed placeholder — confirm
license before classroom release"`. **This is a known, open gap, not an
oversight** — these images' actual provenance/license has not yet been
established and is tracked as part of the ongoing content-quality review
(see `Instructions/progress-and-next-steps.md` for internal maintainers,
or ask the project owner). Do not treat any bundled image as cleared for
redistribution until this is resolved and this section is updated to name
each image's actual source and license.

## Content text

Text content in `content/*.json` is original writing produced for this
project. Slovene content has had real editorial review; English, German,
French, and Spanish content is drawn from a larger candidate pool and has
not yet had native-language review — see `README.md`'s "Content" section
and `Instructions/progress-and-next-steps.md` for the current state.
