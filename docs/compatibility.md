# Compatibility and release-qualification status

This is the release matrix the blueprint's Phase 7 ("Release qualification")
asks for: what's been verified, how, and what still needs a human with
specific hardware/software this development environment doesn't have.
Update it as each row actually gets tested — don't mark something passed
based on a similar-looking row, and don't delete a row that failed.

## How to reproduce the automated checks

```bash
npm run build           # always first — everything below tests release/
npm test                 # unit-level logic
npm run validate-content # content + asset manifest schema
npm run verify-docx      # real LibreOffice: exports every representative worksheet through the actual app, converts via headless soffice, checks page count + that the complete title and passage survived; a missing export fails the run
npm run verify-offline   # fresh Chromium profile, DNS resolution forced to fail, full user journey incl. real .docx downloads, reset-image and built-in-preset behaviour; zero network requests / zero console errors
npm run verify-firefox   # real Firefox via geckodriver: same broad journey, plus packet page-count via WebDriver's real printPage() command
npm run package           # produces dist/writing-worksheet-generator-vX.Y.Z.zip
node scripts/verify-offline.mjs --unzip dist/writing-worksheet-generator-vX.Y.Z.zip   # same offline check, but against the actual extracted ZIP outside the repo
node scripts/verify-firefox.mjs --unzip dist/writing-worksheet-generator-vX.Y.Z.zip   # same Firefox check, against the actual extracted ZIP
```

`verify-docx` and `verify-offline` need `soffice` (LibreOffice), `pdfinfo`
and `pdftotext` (poppler-utils), and Chromium on the machine running
them. `verify-firefox` additionally needs `geckodriver` (`sudo pacman -S
geckodriver` on this Arch-based environment; Firefox itself via `sudo
pacman -S firefox`) and the `selenium-webdriver` npm package (already a
devDependency). All of these are developer/QA tools — never something a
teacher needs to run (blueprint 12: "Office automation is a developer/QA
tool, never a teacher prerequisite").

Binary locations default to this development machine's (`/usr/bin/chromium`,
`soffice` and `firefox` on `PATH`) and can be overridden per run:

```bash
CHROMIUM_BIN=/path/to/chrome npm run verify-docx      # also verify-offline
SOFFICE_BIN=/path/to/soffice npm run verify-docx
FIREFOX_BIN=/path/to/firefox npm run verify-firefox   # geckodriver is still found on PATH
```

`verify-docx` runs LibreOffice with the project's bundled fonts made
visible through a private fontconfig file (`FONTCONFIG_FILE`), so the
conversion uses the real Andika/Lexend/OpenDyslexic/Comic Neue — the
situation on a school machine that installed them — and prints what each
family resolved to. Nothing is installed on the machine. Without this,
LibreOffice silently substitutes (Liberation Sans here), and that
substitution hid a real DOCX line-spacing bug for two releases (see the
pagination note below).

**Continuous integration** (`.github/workflows/ci.yml`, 0.8.1): a `unit`
job (tests, content validation, build, content-status) on every push and
pull request, then `real-environment` (apt LibreOffice Writer + poppler,
Chrome via `browser-actions/setup-chrome`; runs `verify-docx` and
`verify-offline`) and `real-firefox` (Firefox + geckodriver via
`browser-actions`; runs `verify-firefox`) as separate jobs, so a flaky
headless-Firefox run can never hide a green Chromium/LibreOffice run.
Both real-environment jobs export `CHROMIUM_BIN`/`FIREFOX_BIN` from the
setup actions' outputs. First green run on GitHub-hosted `ubuntu-latest`
on 2026-09-20 (commit 808cd0b, after two workflow fixes: `node --test`
needs a glob on Node 22, and `setup-geckodriver` has no `v1` tag) — so
verify-docx, verify-offline and verify-firefox have now all passed on a
machine that is not the development box.

## Multi-page worksheets (0.8)

The old hard one-page-only block is gone (upgrade blueprint v3, workstream
A): one page is still the default target most combinations produce, but a
worksheet that needs more now reports "will print on N pages" and stays
fully printable/exportable. **Verified:** real headless Chromium (a
forced-multi-page worksheet's `Page.printToPDF` output checked with
`pdfinfo`/`pdftotext` against the app's own reported page count and full
text, in both read-copy and read-only modes; the normal single-page case
re-verified as a regression check), real Firefox (`verify-firefox`'s
existing single-worksheet and packet checks, all still exactly the
expected page count), and real LibreOffice via DOCX (see the Office
application matrix below — one case needed an explicit tolerance for a
genuine cross-application pagination difference, not an app bug).
Packets that mix multi-page and single-page sheets print correctly in
any order (an earlier writeup here claimed otherwise and blamed Chromium;
it was an app bug, since fixed — see "Corrected on 2026-09-20" below).

## Browser matrix

| Browser | Status | How verified |
| --- | --- | --- |
| Chromium (headless, this dev environment) | **Automated, passing** | `npm run verify-offline` and the Phase 3–6 CDP-driven scripts referenced in commit history: language switching, every dyslexia support, presets, packets, content import, print, `.docx` export. |
| Firefox (headless, this dev environment — version 155.0.1) | **Automated, passing** | `npm run verify-firefox`, via `geckodriver` + `selenium-webdriver` (Firefox doesn't speak Chrome DevTools Protocol — it speaks WebDriver BiDi, so the Chromium scripts' approach doesn't carry over). Covers all 5 languages, the dyslexia preset, saving a setup, `.docx` export, single-worksheet and packet printing verified via WebDriver's real `printPage()` command (Firefox's actual print/PDF engine) piped through `pdfinfo`/`pdftotext` — not a simulation — a forced multi-page worksheet, and a packet whose settings are changed after it was built (a regression check for a real app bug; see "Corrected on 2026-09-20" below). |
| Google Chrome (real, desktop) | **Not yet tested here** | Same underlying engine as Chromium; low risk, but not the same binary — needs a real run before claiming it. |
| Microsoft Edge (real, desktop — the brief's primary target, "Windows most likely") | **Not yet tested here** | Chromium-based; same low-but-nonzero risk as Chrome. This is the brief's actual primary target browser and should be the first real-browser check done outside this environment. |
| Firefox (real, desktop) | **Not yet tested** | The headless automated run above is real Firefox, but a real desktop session (different windowing/print-dialog path) hasn't been checked. |
| Safari | **Not tested — not applicable to this Linux dev environment** | Lower priority per the brief ("Windows most likely, possibly Mac/Linux") but should be checked before claiming Mac support. |

### Corrected on 2026-09-20: two "browser engine bugs" that were not

Until 2026-09-20 this file carried two sections describing print bugs
attributed to browser engines. The project owner's code review questioned
both; each was then reproduced and made to disappear by a single isolated
fix, with nothing else changed. Neither was a browser bug. They are
recorded here so nobody re-documents the symptoms as browser limitations.

**"Firefox-specific known issue: print pagination can become unreliable
after enough prior re-renders in the same tab"** (documented since Phase
7; a 2-sheet packet printing as 5 pages). Actual cause: a defect in
`scripts/verify-firefox.mjs` itself. Its `checkPacketPageCount()` helper
replaced `#print-surface.replaceChildren` with a once-only wrapper to
observe the packet DOM before the app's post-print restore, and never put
the original back. Its second use in the same page wrapped the already-
spent wrapper, so the second packet was never written to the print
surface and Firefox faithfully printed the stale first packet. Restoring
the method between calls made the "bug" vanish with no app change. The
"extensive bisection" that ruled out app-level causes was consistent with
this all along — nothing about the second packet mattered because the
surface never changed. The section is now a real, failing check.

**"Chromium-specific known issue: a non-last multi-page sheet in a packet
can lose pages"** (introduced with 0.8 multi-page support). Actual cause:
an app bug. `buildWorksheet()` stored the live settings object *by
reference* in every model, and the app mutates that object in place on
every control change — so every packet sheet's font size, line height,
writing mode, tint and header silently followed whatever the teacher
changed afterwards, at print time, while the sheet's frozen layout and
page count still described the settings it was added with. A sheet
"losing pages" was that sheet legitimately fitting on fewer pages at the
*new* settings, plus its stale second copy-block forcing a page break.
`structuredClone(settings)` in `buildWorksheet()` alone makes both
previously-failing packet orderings print exactly the expected page
count. The "five independent CSS/DOM approaches" that all failed
identically were all varying the wrong thing.

**Lesson, applied going forward:** a "known browser issue" must be
reproducible in a minimal standalone HTML page with no app code before
it is documented as one. Both of these would have failed that test in
minutes. If either symptom ever reappears, treat it as an app or test
regression first.

## Office application matrix

| Application | Status | How verified |
| --- | --- | --- |
| LibreOffice (real, headless, this dev environment — version 26.8.0.3) | **Automated, passing** | `npm run verify-docx`: 11 representative `.docx` exports (every bundled language, every font, every writing mode, the near-max-content level-5 boundary case in two languages, tint, sentence-per-line, a maximum-word-spacing case, and — since 0.8's multi-page support — two genuinely multi-page cases) — each downloaded from the real running app (not hand-built), converted to PDF with real `soffice --convert-to pdf`, and checked against the *app's own reported page count* (read from the fit indicator, not a hardcoded 1) and non-empty extracted text via `pdfinfo`/`pdftotext`. All 11 pass on the current codebase with no tolerance, run against the real bundled fonts (a `toleratedPageDelta: 1` on the 24pt multi-page case was removed in 0.8.1 once its cause turned out to be an exporter bug — see below). An earlier draft of this check hand-built the WorksheetModel instead of driving the real app, hardcoded a guess at the handwriting-line row count, and reported 2 false "page overflow" failures for the level-5 cases — a reminder that this kind of check is only trustworthy when it exercises the real, live fit-checked output, not a re-implementation of it. (0.8 gotcha found while adding the word-spacing case: two cases sharing the same language+level download to the same filename, and Chromium's headless auto-download silently overwrites rather than uniquifying — each case now needs a distinct language+level pair, not just a distinct label.) |
| LibreOffice (real, interactive desktop GUI) | **Not yet tested** | The headless conversion above proves PDF-rendered pagination; it does *not* prove the file *opens cleanly*, *displays correctly on screen*, or that a teacher can *edit the text* in LibreOffice Writer afterward without breaking colors/spacing. Open a few exported files in the actual LibreOffice Writer GUI and check visually. |
| Microsoft Word (real) | **Not tested — Word is not available in this Linux development environment** | This is the single most important remaining compatibility gap (blueprint: "the pilot needs editable output," and font substitution behavior is genuinely Word-specific, not just "close enough to LibreOffice"). Needs the user's own Windows machine with a real, licensed Word install. Checklist below. |
| OpenOffice | **Not tested** | Lower priority per blueprint ("include OpenOffice's actual import behavior before claiming it supported" — basic, not blocking). |

**LibreOffice-vs-Chromium pagination note (0.8, corrected in 0.8.1):**
since a worksheet may now span more than one page (see the multi-page
section earlier in this document), each DOCX case is checked against the
app's *own* reported page count rather than a fixed "1". In 0.8 one case
(`en-andika-level5-readcopy-multipage`, 24pt read-copy) needed a
`toleratedPageDelta: 1`: the app and real Chromium print said 2 pages,
LibreOffice said 3, and this document called that "a cross-application
pagination difference, not a bug in this app". **That was wrong.** The
DOCX exporter set body line spacing with Word's default "auto" rule,
which multiplies the *font's own* natural line height — 1.61em for
Andika, 1.25em for Lexend — where the preview's CSS `line-height: 1.4`
multiplies the font size. With the real Andika that is 2.25em per line,
60% taller than the preview; with LibreOffice's Liberation Sans
substitute (1.15em) it was only 15% taller, which most one-page cases
absorbed and the 24pt case did not. The fonts were never installed on
the development machine, so the substitute's near-miss was all
`verify-docx` ever saw. Found when CI work (F4) made the bundled fonts
visible to LibreOffice: 6 of 11 cases went to two pages, including a
level-1 Slovene text. The exporter now uses the EXACT rule
(`lineHeightMultiplier × fontSizePt`, in twips; unit-tested), all 11
cases match the app's page count with the real fonts and with
substitutes alike, and the tolerance is removed. The general point
stands — editable DOCX cannot *promise* identical pagination in every
office application, PDF remains the print reference — but it must not
be used to explain away a measurable discrepancy before the cause is
known.

### Real-Word checklist (needs the user's own machine)

For at least one exported `.docx` per language and per writing mode (3 × 5 = 15, or a representative subset — see `verify-docx`'s CASES list for a starting set):

- [ ] File opens without a repair/corruption prompt.
- [ ] Page count matches what the app reported when the file was exported
      (Word's own layout engine, not LibreOffice's or Chromium's — a
      near-boundary case, especially anything using the maximum font size
      or line height, may reasonably differ by one page; anything fitting
      comfortably within budget should not).
- [ ] Confused-letter colors (b/d/p/q) are the correct colors, not default black.
- [ ] Syllable colors (where enabled) survived.
- [ ] The embedded image displays (not a broken-image icon, not a linked/missing external reference).
- [ ] Read-copy mode: handwriting-line rows are present and evenly spaced; if the app reported a second copy-practice block (a fresh page of rules), confirm Word actually starts it on a new page rather than overflowing the first.
- [ ] Font: note what Word actually renders each exported font as. Fonts are *not* embedded in the `.docx` (documented, known limitation since Phase 0) — if Andika/Lexend/OpenDyslexic/Comic Neue aren't installed on the test machine, Word will substitute a fallback. Record which fallback Word picks for each, since that's useful information for a school's IT setup instructions.
- [ ] Edit the text (type a sentence, delete a sentence) and confirm the document remains usable — colors/spacing on the *edited* text may reasonably degrade (blueprint explicitly doesn't promise otherwise), but the file itself shouldn't break.

## Fresh-machine / offline test

**Automated, passing.** `npm run verify-offline` (and the ZIP-specific
variant, `node scripts/verify-offline.mjs --unzip dist/...zip`) launches a
completely fresh Chromium profile with DNS resolution forced to fail for
any real network attempt (`--host-resolver-rules=MAP * ~NOTFOUND` — a
request would error out, not happen to succeed because the test machine
itself has internet access), extracts the actual packaged ZIP to a
directory outside the repo, and drives a broad real user journey: every
bundled language, the dyslexia-friendly preset, saving a setup, adding to a
packet, printing, printing the packet, and exporting
`.docx`. Current result: **zero non-`file://`/`data:` network requests,
zero console errors or exceptions.**

`npm run verify-firefox` applies the same offline principle for Firefox —
a fresh profile (geckodriver's default) with network egress hard-blocked
via an unreachable proxy (Firefox has no exact equivalent of Chromium's
`--host-resolver-rules`, so a dead proxy is the closest substitute; file://
navigation is never proxied, so it's unaffected) — and confirms zero
console errors across the same kind of broad journey.

Not yet tested: a genuinely separate physical/virtual machine with *no*
development tooling installed at all (Node, browsers other than whatever
ships by default, etc.) — this environment's Chromium is a real, complete
browser, but it's still a development machine. Worth at least one real run
on a plain school-issued computer before calling this exit condition fully
met.

## Physical printer tests

**Not tested — no physical printer in this environment.** Needs the user's
own hardware. Checklist:

- [ ] At least one color inkjet/laser printer, at least one grayscale-only
      printer.
- [ ] Print a worksheet with default settings (tint off, stripes off) —
      confirm A4, 20mm margins, no browser header/footer bleeding in, and
      that `print-color-adjust: exact` is actually honored (confused-letter
      colors print as the intended colors, not default black text).
- [ ] Print with tint **on** and "also print the tinted background" on —
      confirm it's visible but not so heavy it interferes with readability,
      and check the ink/toner cost is acceptable for routine classroom use.
- [ ] Print with alternate-line stripes on and "also print the stripes" on
      — same check.
- [ ] Print a packet of 3+ sheets — confirm it comes out as one physical
      print job, correct page order, no blank trailing page.
- [ ] On the grayscale printer specifically: confirm confused-letter colors
      (b=red, d=green by default) remain visually distinguishable once
      printed in grayscale — the blueprint is explicit that red/green "must
      not be the only way the interface communicates meaning," and a
      grayscale print is exactly the scenario where that matters most.
- [ ] Compare that grayscale print with the app's grayscale preview: the
      preview uses CSS `grayscale()`, which a printer driver may not match.
      With the default colors the preview's grey-collision notice appears
      (b and d are 0.110 vs 0.097 in relative luminance; the threshold is
      0.05) — note whether b and d really are hard to tell apart on paper,
      so the threshold can be adjusted.

## Licenses

- **Fonts** — resolved. All four bundled fonts are SIL Open Font License
  1.1, verified against the actual bundled `OFL.txt` files. See
  `THIRD_PARTY_NOTICES.md`.
- **The `docx` library** — resolved. MIT, license copy in
  `licenses/docx-MIT.txt`.
- **Images** — resolved. Every bundled image is original artwork the
  project owner generated with ChatGPT (OpenAI); per OpenAI's Terms of Use
  at generation time, the creator owns that output. `assets/manifest.json`
  now records this per image (all rights reserved by the project owner,
  bundled for this project only — not an open license). See
  `THIRD_PARTY_NOTICES.md` for the full statement and its caveats.
  Separately (a licensing-independent content-accuracy concern): the 4
  entries that used an outright mismatched image (a castle showing a
  windmill, etc.) now have new, correctly-matched images the project
  owner generated in the same style — verified byte-for-byte to be the
  ones actually rendered. Most other DE/FR/ES entries still use topically
  reassigned substitute images that are plausible but unverified; listed
  as open in `README.md`, "Status".
- **Content text** — Slovene has real editorial review. English, German,
  French, and Spanish have had a close editorial pass (grammar, natural
  phrasing, facts, syllable-break correctness) but not a native speaker's
  review.

## Teacher documentation

**Done.** `docs/teacher-guide.md` — worksheet creation, reading/writing
supports, presets (including backup/restore), packets, content
import, and the Reset action. Written for a non-technical reader per the
original brief's deliverable #3.

## Versioned ZIP release

**Done.** `npm run package` rebuilds `release/` and produces
`dist/writing-worksheet-generator-v<version>.zip`, containing the release
build plus `docs/`, `THIRD_PARTY_NOTICES.md`, and `licenses/`. Verified
that the packaged ZIP extracts and runs standalone (see "Fresh-machine /
offline test" above) — this was tested against the actual ZIP artifact,
not just the repo's `release/` folder.

Current version is `0.9.0-rc.2` — a release *candidate*, not a final
`1.0.0`: the image-license and native-language-content-review gaps above
are real, open, user-facing-risk items, not paperwork. Don't bump to
`1.0.0` until those are resolved.
