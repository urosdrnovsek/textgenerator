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
npm run verify-docx      # real LibreOffice: exports every representative worksheet through the actual app, converts via headless soffice, checks page count + text
npm run verify-offline   # fresh Chromium profile, DNS resolution forced to fail, full user journey, checks zero network requests / zero console errors
npm run verify-firefox   # real Firefox via geckodriver: same broad journey, plus packet page-count via WebDriver's real printPage() command
npm run package           # produces dist/writing-worksheet-generator-vX.Y.Z.zip
node scripts/verify-offline.mjs --unzip dist/writing-worksheet-generator-vX.Y.Z.zip   # same offline check, but against the actual extracted ZIP outside the repo
node scripts/verify-firefox.mjs --unzip dist/writing-worksheet-generator-vX.Y.Z.zip   # same Firefox check, against the actual extracted ZIP
```

`verify-docx` and `verify-offline` need `soffice` (LibreOffice), `pdfinfo`
and `pdftotext` (poppler-utils), and `/usr/bin/chromium` on the machine
running them. `verify-firefox` additionally needs `geckodriver` (`sudo
pacman -S geckodriver` on this Arch-based environment; Firefox itself via
`sudo pacman -S firefox`) and the `selenium-webdriver` npm package
(already a devDependency). All of these are developer/QA tools — never
something a teacher needs to run (blueprint 12: "Office automation is a
developer/QA tool, never a teacher prerequisite").

## Browser matrix

| Browser | Status | How verified |
| --- | --- | --- |
| Chromium (headless, this dev environment) | **Automated, passing** | `npm run verify-offline` and the Phase 3–6 CDP-driven scripts referenced in commit history: language switching, every dyslexia support, presets, packets, content import, print, `.docx` export. |
| Firefox (headless, this dev environment — version 155.0.1) | **Automated, passing except one known Gecko engine issue (see below)** | `npm run verify-firefox`, via `geckodriver` + `selenium-webdriver` (Firefox doesn't speak Chrome DevTools Protocol — it speaks WebDriver BiDi, so the Chromium scripts' approach doesn't carry over). Covers all 5 languages, the dyslexia preset, saving a setup, `.docx` export, and both single-worksheet and packet printing verified via WebDriver's real `printPage()` command (Firefox's actual print/PDF engine) piped through `pdfinfo`/`pdftotext` — not a simulation. All pass in the clean/primary flow (create a worksheet and print it; build a packet and print it immediately, matching the documented `docs/teacher-guide.md` workflow). One known issue found and documented separately below. |
| Google Chrome (real, desktop) | **Not yet tested here** | Same underlying engine as Chromium; low risk, but not the same binary — needs a real run before claiming it. |
| Microsoft Edge (real, desktop — the brief's primary target, "Windows most likely") | **Not yet tested here** | Chromium-based; same low-but-nonzero risk as Chrome. This is the brief's actual primary target browser and should be the first real-browser check done outside this environment. |
| Firefox (real, desktop) | **Not yet tested** | The headless automated run above is real Firefox, but a real desktop session (different windowing/print-dialog path) hasn't been checked. Given the known issue below, this is worth a real run specifically to see whether ordinary interactive use (not automation) hits it too. |
| Safari | **Not tested — not applicable to this Linux dev environment** | Lower priority per the brief ("Windows most likely, possibly Mac/Linux") but should be checked before claiming Mac support. |

### Firefox-specific known issue: print pagination can become unreliable after enough prior re-renders in the same tab

**Found**, not fixed — this is a real Gecko (Firefox's rendering engine)
bug, not a bug in this app's CSS/DOM, based on extensive bisection (see
the Phase 7 Firefox-testing commit for the full investigation). Documented
here per this project's standing rule: report limitations honestly rather
than omit them.

**What happens:** in the same Firefox tab, after enough prior worksheet
re-renders have happened (the exact trigger found: 2 or more sequential
*settings changes* — e.g. font size then line height — applied to the
*current* worksheet), the *next* print operation can come out wrong. For
packet printing specifically, this manifests as an extra blank page
inserted after every sheet (5 sheets → 10 pages, half blank). In one
observed case deep into a long test session, it also affected a plain
single-worksheet print (1 page → 5). The worksheet's own fit-check is not
wrong in either case — the app correctly reports the content fits; the
corruption is in Firefox's own print/PDF pagination.

**What was ruled out** (so this isn't misdiagnosed as an app bug on a
future pass): specific content, specific language/theme/font, each
individual setting changed alone (font size alone: fine; line height
alone: fine — only combinations of 2+ trigger it), `#print-surface`'s own
render history, the hidden `#preview` pane's content (cleared it — no
change), DOM node identity (rebuilt `#print-surface` as a fresh element —
no change), and timing (added up to 3 full seconds of settle time between
steps — no change). The trigger is specifically *how many* unrelated
re-renders happened earlier in the tab's lifetime, not their content or
timing.

**Practical mitigation for now:** if a teacher has been actively adjusting
settings for a while in one browser session, reload the page (or just
close and reopen the app) before printing a packet, especially a large
one. This resets whatever internal Firefox state accumulates. Building a
packet and printing it right away — the workflow `docs/teacher-guide.md`
actually describes — is unaffected; that path is covered by
`verify-firefox`'s primary (non-demonstration) checks and passes cleanly.

**Not pursued further this pass** (explicit decision, not an oversight):
possible next steps would be filing a minimal reproduction with Mozilla
(Bugzilla) or trying more invasive structural workarounds (e.g. rendering
print content in an iframe) — neither was attempted, since everything
tried at the CSS/DOM level had no effect, suggesting the fix would need to
happen inside Gecko itself or require much deeper investigation than is
warranted right now.

## Office application matrix

| Application | Status | How verified |
| --- | --- | --- |
| LibreOffice (real, headless, this dev environment — version 26.8.0.3) | **Automated, passing** | `npm run verify-docx`: 9 representative `.docx` exports (every bundled language, every font, every writing mode, the near-max-content level-5 boundary case in two languages, tint, sentence-per-line, `{name}` personalization, and — since 0.8 — a maximum-word-spacing case) — each downloaded from the real running app (not hand-built), converted to PDF with real `soffice --convert-to pdf`, and checked for exactly 1 page and non-empty extracted text via `pdfinfo`/`pdftotext`. All 9 passed on the current codebase. An earlier draft of this check hand-built the WorksheetModel instead of driving the real app, hardcoded a guess at the handwriting-line row count, and reported 2 false "page overflow" failures for the level-5 cases — a reminder that this kind of check is only trustworthy when it exercises the real, live fit-checked output, not a re-implementation of it. (0.8 gotcha found while adding the word-spacing case: two cases sharing the same language+level download to the same filename, and Chromium's headless auto-download silently overwrites rather than uniquifying — each case now needs a distinct language+level pair, not just a distinct label.) |
| LibreOffice (real, interactive desktop GUI) | **Not yet tested** | The headless conversion above proves PDF-rendered pagination; it does *not* prove the file *opens cleanly*, *displays correctly on screen*, or that a teacher can *edit the text* in LibreOffice Writer afterward without breaking colors/spacing. Open a few exported files in the actual LibreOffice Writer GUI and check visually. |
| Microsoft Word (real) | **Not tested — Word is not available in this Linux development environment** | This is the single most important remaining compatibility gap (blueprint: "the pilot needs editable output," and font substitution behavior is genuinely Word-specific, not just "close enough to LibreOffice"). Needs the user's own Windows machine with a real, licensed Word install. Checklist below. |
| OpenOffice | **Not tested** | Lower priority per blueprint ("include OpenOffice's actual import behavior before claiming it supported" — basic, not blocking). |

### Real-Word checklist (needs the user's own machine)

For at least one exported `.docx` per language and per writing mode (3 × 5 = 15, or a representative subset — see `verify-docx`'s CASES list for a starting set):

- [ ] File opens without a repair/corruption prompt.
- [ ] Page count is exactly 1 (Word's own layout engine, not LibreOffice's).
- [ ] Confused-letter colors (b/d/p/q) are the correct colors, not default black.
- [ ] Syllable colors (where enabled) survived.
- [ ] The embedded image displays (not a broken-image icon, not a linked/missing external reference).
- [ ] Read-copy mode: handwriting-line rows are present, evenly spaced, and don't overflow onto a second page.
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
  reassigned substitute images that are plausible but unverified; tracked
  in `Instructions/progress-and-next-steps.md`.
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

Current version is `0.7.0-rc.1` — a release *candidate*, not a final
`1.0.0`: the image-license and native-language-content-review gaps above
are real, open, user-facing-risk items, not paperwork. Don't bump to
`1.0.0` until those are resolved.
