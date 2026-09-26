# Changelog

Development history, moved out of `README.md` on 2026-09-20 so the README
can be an introduction rather than a log. Newest first. Each entry
summarizes what shipped and what was verified; the commit messages in
`git log` carry the full per-change detail and are the source of truth.

## Unreleased

Work on branch `upgrade/activities` (new worksheet activities and reading
supports).

- **One tokenizer and one styling function (no visible change).**
  `src/text/tokenize.js` is now the single definition of a word, a
  sentence and a syllable boundary, and one `styleText` function replaces
  the two separate run builders. Styled runs carry word and syllable ids,
  and the preview spans carry them as `data-w` / `data-syl`: the basis for
  clicking words (gap-fill, choosing a sentence) and syllable arcs.
  Checked three ways: a new golden test fingerprints the exact characters
  and colours of all 318 texts in 32 styling combinations and matches
  exactly; all 318 texts measured in real Chromium, in default settings
  and with separators + sentence-per-line + stripes, give identical
  height, page count, line count and text length before and after; and
  the full browser/LibreOffice/Firefox suite passes.
- **The page is a list of blocks (no visible change).** The worksheet
  model now lists its content as blocks (header, title, picture,
  passage), and the preview/print renderer and the Word exporter each
  draw them from one table. The fit check walks the same list. The page
  order used to be written out three times (renderer, fit check, Word
  exporter). The writing modes are rows of one activities table, which
  decides whether the passage is traced and whether copy lines follow.
  New activities will add a row, not `if` branches. Checked:
  `document.xml` is byte-identical for all 318 texts in 5 setting
  combinations, and the rendered preview and print markup, fit line,
  height and page count are identical for all 318 texts in 4 browser
  configurations.
- **A line for advisory notices (nothing shows yet).** A new
  `src/worksheet/advice.js` looks at the worksheet and returns short
  notice codes. The fit check passes them on, and they appear as a
  separate line under the fit indicator. Notices never block printing and
  never change the layout. No notice exists yet: the grayscale check
  (next) is the first one. Checked: unit tests; the offline journey now
  asserts the line is hidden on a plain sheet; and a temporary probe build
  that always returned one notice showed exactly one visible item with no
  console errors (not committed).
- **Grayscale preview.** A new "Preview in grayscale (black-and-white
  printer)" checkbox greys the on-screen preview only; it is not saved in
  setups and never reaches the printed sheet or the Word file. While it
  is on, a notice appears when two colours that tell things apart (the
  confused-letter colours among themselves, or the two syllable colours
  when they print) come out almost the same grey. The notice is computed
  for every sheet but held back while the preview is in colour, because
  the default red b / green d always trigger it (owner decision). The
  wording is written in all five languages; the owner checked the
  Slovene. Checked: unit tests (the default b/d pair is
  detected; syllable colours count only when the text has syllable data;
  every notice has a string in all five languages), and the offline
  journey drives the checkbox in Chromium: the preview gets
  `grayscale(1)`, the print surface stays unfiltered, the notice shows
  only while the view is on, and it goes when letter colours are off.
- **Line numbers.** A new "Line numbers" checkbox numbers every line of
  the passage, small and grey, down its left side, in one count across
  pages (the title, picture and copy lines are not numbered). The numbers
  sit in an 8 mm gutter inside the page, so the text rewraps a little
  narrower and the page-count check sees it. The Word file uses Word's
  own line numbering, with the passage indented by the same 8 mm. Saved
  setups include the option; setups saved by 0.9 load with it off.
- **Drawing box ("read it, then draw it").** A new "Picture on the
  sheet" choice: the text's picture (as before), a drawing box, or no
  picture. The drawing box is an empty 9 cm bordered box after the text;
  in read & copy the copy lines fill whatever room is left, and move to a
  fresh page when too little is left, as before. In Word it is a table
  row of exact height, like the copy lines. Saved setups include the
  choice; setups saved by 0.9 keep the picture. The owner checked the
  Slovene labels.
- **Answer keys.** In "Fill the gaps", a "Show the answers" checkbox
  turns the sheet into its answer key: every gap shows its word in bold
  (in the preview, the print and the Word file), and an "Answers" tag
  sits at the top right so the key isn't handed out by mistake. The
  choice belongs to the text on screen, like the gaps. "Add to packet"
  once with it off and once with it on puts the student sheet and its
  key in one print run.
- **Page count and its safety margin (documented, unchanged).** The page
  check keeps 4 mm in reserve at the bottom of every page, so it may say
  one page more than a sheet actually prints when the content ends
  within 4 mm of a page end (found on an answer key: 10 reported, 9
  printed in Chromium and Firefox). It never says fewer. The owner chose
  to keep the margin; the tests now tell this known over-count apart
  from a real mismatch.
- **Fill the gaps.** A new writing mode makes a gap-fill sheet. The
  teacher clicks words in the preview to turn them into gaps (or back),
  or uses "Gap every Nth word" (N from 3 to 10, 7 by default), which
  leaves the first sentence whole, as the classic cloze procedure does.
  Words can also be chosen with the keyboard (arrow keys, then Space or
  Enter). All gaps on a sheet have the same width, sized for a child to
  write the longest missing word, so a gap's length doesn't give the
  answer away. The preview shows each answer faintly inside its gap; the
  printed sheet and the Word file don't have them. At most 40% of a
  text's words can be gaps. The sheet prints "Fill in the missing
  words." under the title. The gaps belong to the text on screen:
  choosing another text starts with none, and gaps are never saved. A
  notice says when a gap-fill sheet has no gaps yet. In the Word file a
  gap is an underlined run of spaces, an estimate of the preview's width.
- **Word files: no more lines pushed to the next page (bug fix).** Word
  and LibreOffice keep at least two lines of a paragraph together on a
  page by default ("widow/orphan control"); the app's preview allows a
  single line, as its page count assumes. When a paragraph's first or
  last line fell alone at a page break, the Word file moved it and could
  come out a page longer than the app said. The Word export now switches
  this off for the passage, as the preview does. Found while testing
  visible word spaces (a 28pt trace sheet: 4 pages in LibreOffice, 3 in
  the app; 3 in both after the fix). Nothing else in the files changed.
- **Highlight letters.** A new "Highlight letters" field takes up to
  four letter groups, separated by commas (for example `ch, sch, š`).
  Wherever a group occurs inside a word, it is printed in its own colour
  and in bold, in the preview, the print and the Word file. Longer groups
  win (`sch` in *Schule*), matching ignores case, and a group never
  crosses from one word into the next. The highlight takes precedence
  over the b/d/p/q and syllable colours. Invalid input (digits,
  punctuation, a group longer than four letters, more than four groups)
  shows a message next to the field and changes nothing. Saved setups
  include the groups. The four colours are navy, teal, rust and pink;
  they can't all be far apart in grey, which is why the groups are also
  bold. The grayscale check compares them with the letter colours.
- **Visible word spaces.** A new checkbox puts a faint grey `_` in every
  space between two words of a sentence ("Maja _ ima _ muco."), for
  children still learning where one word ends. There is none between
  sentences, where the full stop and capital already mark the break. The
  mark is a real character, so the Word file has it too and the page
  check measures the extra width. It stays with the word before it, so
  a line may end with a mark but never starts with one. The planned
  mark (␣) turned out to exist in only one of the four fonts; the owner
  chose the underscore, which all four have.
- **Write about the picture.** A new writing mode: the title, a short
  instruction for the child ("Look at the picture and write about it."),
  the picture in a larger 120 × 90 mm box, and ruled lines for the rest
  of the page; the text itself is not printed. It can use the drawing box
  instead of the picture, but not "no picture" (that option is disabled
  while the mode is chosen). The instruction line is a new header option,
  on by default, and only activities that have an instruction print one,
  so the other modes print exactly as before. The instruction is written
  in all five languages; the owner checked the Slovene, and none of the
  others has had a native-speaker review.

## 0.9.0-rc.2 — 2026-09-24 (beta hotfix)

A bug-fix build for the tester teachers. It has no new features and no
content changes. The fixes were found while preparing the activities
upgrade (branch `upgrade/activities`) and moved to the beta because two
of them lost text on printed sheets.

- **Printed packets keep their line stripes.** A packet sheet was rendered
  into a detached element, where line boxes measure as zero, so every
  packet printed without stripes even with "print stripes" on. Reproduced
  in real Chromium (7 stripes on the single print surface, 0 in the
  packet) and fixed by rendering each sheet into the laid-out print
  surface. Now 7 and 7. The same mechanism will carry syllable arcs and
  line numbers.
- **A worksheet that fails to build is never left printable.** Before, an
  exception while building or measuring left the previous sheet on screen
  with Print enabled. Now the preview clears, Print/Word/Add to packet are
  disabled, and the fit line explains (new `fit.internalError` string in
  all five languages). Checked by forcing a font-load failure in the real
  app.
- `docx` is pinned to exactly 9.7.1, the version the lockfile already
  installed. It is bundled into the release, and a minor update can
  change Word output.
- **Paragraph breaks print again.** 73 of 318 texts contain authored
  paragraph breaks, and all three outputs lost them. HTML collapsed the
  newlines to a space, and DOCX kept them inside one run, which
  LibreOffice printed as two spaces. Each paragraph is now its own
  paragraph in the model, the preview, print and Word, with the same
  small gap in both (DOCX never had the gap before). Checked in Chromium
  (the Mosaic text shows 3 paragraphs) and LibreOffice. **Consequence,
  accepted by the owner:** 17 level-5 texts in read-and-copy mode still
  fit their text on page 1 but now have fewer than three copy lines
  left, so the copy lines move to a second page ("will print on 2
  pages"). No other page counts changed.
- **Sentence-per-line lost text in two situations; both fixed.**
  (1) With syllable separators on, the inserted `·` marks were counted
  as text when cutting sentences. Every sentence was cut short, and the
  passage's last words were dropped ("Muca spi." printed as "Mu·ca").
  (2) The sentence splitter skipped a quoted exclamation that the
  sentence continues past (`„Du kommst nie ans Ziel!“, riefen sie.`), so
  those words vanished from the German snail race and the Spanish
  caracol story. A new test rebuilds every bundled text in every
  paragraph/syllable combination and requires every character back.
  With the old code, the test fails.

## 0.9.0-rc.1 — 2026-09-21 (content: 318 texts, name field removed)

The beta build handed to tester teachers. Everything below happened on
2026-09-21 unless dated otherwise; the app itself is 0.8.1's with one
user-visible change (no "Child's name" field) and much more content.

- **Slovene: three texts per theme and level** (2026-09-21). Fifty texts
  curated from the raw Slovene pool (`Texts collection/sl_texts.json`),
  two per cell, after a Slovene teacher reviewed the pool and their
  corrections were applied: the lost kite, the key under the mint (at
  five levels, with its chest of postcards), the red mitten, the bell on
  the path, the moonlit picnic, the forest concert, the hidden bench;
  hedgehog, hummingbird, fox, beaver, octopus, owl, chameleon, sea
  turtle, wolves; the Eiffel Tower and the Sahara at several levels,
  Venice's canals, the Great Wall, Machu Picchu; magnets, echoes,
  bridges, seeds, the Moon's phases; snowflakes, the water cycle, bird
  migration, snow as a blanket, fungi, forest layers, thunderstorms,
  pollination, animals in winter. Seventeen pictures bundled from the
  raw image pool (+1.2 MB; ZIP now 11.4 MB). Slovene words are long:
  the eight non-story level-5 texts and the original Venice text each
  lost one to three sentences to fit a page — every text in every pack
  now fits one page at default settings. Every pack now has at least
  two texts in every cell (318 in all); the two Slovene `verify-docx`
  cases are pinned, and the "one text hides the title list" behaviour is
  now checked through the teacher import flow in `verify-offline`.
- **Spanish: two texts per theme and level** (2026-09-21). Twenty-five
  original Spanish texts on the Slovene topics and pictures, as for
  French and German (Sofía and the wet kitten, the white egg, Tito the
  snail's race, the barn, the kitten's new home; the owl, the bee, the
  dolphins, the bat; the pyramids at four levels and Venice; the rainbow
  at four levels and gravity; seed, rain, wind, the seasons). Exception:
  the Spanish pack already had the autumn-leaves topic in every nature
  cell, so nature level 4 is the red squirrel's winter store instead.
  Syllables per the RAE rules. Every Spanish title fits one page at
  default settings in real Chromium — running that check over the whole
  Spanish pack for the first time also caught the existing level-5
  autumn-leaves text spilling onto a second page; a sentence that
  repeated an earlier one was removed (version 2). The same sweep found
  the Slovene Venice text (level 5) doing the same; it is recorded for
  the owner, not changed. The Spanish `verify-docx` case is pinned.
  Native-speaker review: still none (0 of 243 non-Slovene entries).
- **German: two texts per theme and level** (2026-09-21). Twenty-five
  original German texts on the Slovene topics and pictures, as for
  French the same day (Lena and the wet kitten, the white egg, Theo the
  snail's race, the barn, the kitten's new home; the owl, the bee, the
  dolphins, the bat; the pyramids at four levels and Venice; the
  rainbow at four levels and gravity; seed, rain, wind, autumn leaves,
  the seasons). Written syllables follow the pack's Duden convention.
  Every German title fits one page at default settings in real Chromium
  (the Venice text was trimmed once to get there); the two German
  `verify-docx` cases are pinned to the texts they were written for.
  Native-speaker review: still none (0 of 218 non-Slovene entries).
- **French: two texts per theme and level** (2026-09-21). Twenty-five
  original French texts, one per cell, each on the topic and picture of
  the matching Slovene entry — so the French pack now tells the same
  stories and explains the same things as the Slovene one (Chloé and the
  wet kitten, the white egg, Léon the snail, the barn, the kitten's new
  home; the owl, the bee, the dolphins' names and echolocation; the
  pyramids at four levels and a walk through Venice; the rainbow at four
  levels and gravity; the seed, the rain, the wind, the autumn leaves and
  the four seasons). Exception: the animal level-4 cell already had the
  bat on that picture, so the octopus and the jar is used there instead.
  Written syllables follow the pack's French convention (`ée` whole,
  `cons|trui|tes`, `mer|veil|leux`, `cro|yait`). Every French title fits
  one page at default settings in real Chromium; the two French
  `verify-docx` cases are pinned to the texts they were written for.
  Native-speaker review: still none (0 of 193 non-Slovene entries).
- **A fourth English story per level** (2026-09-21, round 2 batch 1).
  Five original stories written for pictures from the owner's new
  drop, now bundled (`storm_dog`, `blanket_fort`, `library_map`,
  `pottery_wheel`, `mountain_camping`, ~80 KB each): a thunderstorm
  counted out under a blanket, a fort of chairs and Grandma's quilt, a
  treasure map that turns out to show the playground, a first bowl on
  Grandpa's pottery wheel, and a sunrise nobody else meant to wake up
  for. Children named to match the pictures (Mia; Mia and Tom). All
  fit one page at default settings in real Chromium; the title list
  simply shows four entries now.
- **A fourth English animal text per level** (round 2 batch 2). Five
  more pictures bundled from the drop (`hummingbird`, `red_panda`,
  `sea_turtle_cleaners`, `orangutan`, `humpback_calf`): the humming
  bird that hovers and flies backwards, the red panda and its tail, the
  turtle's "car wash" at a reef cleaning station, the orang-utan as
  "person of the forest" (arm span, nightly nests, seven years with its
  mother, the forests being cut), and the humpback's migration with its
  calf (born car-length, hundreds of litres of milk a day, the mother
  fasting, the males' songs). All fit one page at default settings in
  real Chromium.
- **A fourth English science text per level** (round 2 batch 3). Five
  more pictures bundled (`solar_oven`, `electric_circuit`,
  `ammonite_fossil`, `backyard_telescope`, `mars_rover`): biscuits
  baked in a foil-lined box, a battery-switch-bulb circuit, an ammonite
  on a mountainside and how it got there, Saturn through a garden
  telescope (why planets don't twinkle, "wanderers"), and a rover on
  Mars (cameras, drill, the twenty-minute signal delay, rocks laid down
  by water). All fit one page at default settings in real Chromium.
- **Round 2 complete** (batch 4): three last pictures bundled
  (`sunflower_planting`, `tree_frog`, `roman_mosaic`) for the cells they
  fit — planting a sunflower and waiting (nature L2), a tree frog and the
  wet and dry seasons where there is no winter (nature L3), and a Roman
  mosaic workshop with the Pompeii "Beware of the dog" floor (around
  the world L4). The English pack now has 93 entries. The 19 pictures
  bundled since 0.8.1 add about 1.5 MB to the download (ZIP now ~10.2 MB).
- **Story pictures now match the child in the text.** Every story
  picture was compared with every text that uses it (16 pictures, 35
  entries, five languages). Eight entries had the wrong gender: the three
  Slovene "Tom" stories were illustrated with a girl (the pictures were
  drawn for these texts; "Tom" came from the 0.8 default-name decision),
  so they are now about Mia with feminine verb forms (*preživljala,
  čakala, sklonila, Deklica*…; version 3, wording otherwise untouched);
  English "The Patient Kite" is Mia and Grandpa (was Noah and a
  gardener); German "Die wandernde Wollmütze" is now "Der rote
  Handschuh" — Leon finds a red mitten and a girl comes for it, as the
  picture shows (was Leni, a yellow hat and a boy); French "La boîte à
  musique" is about Léa (was Noé) and "La clé minuscule" about Noé (was
  Zoé). The French bike story (a boy and his sister) sat on a girl-with-
  kite picture; it now has a bundled bicycle picture (`bicycle_repair`,
  owner-generated like the rest, +81 KB). The two German entries "Das
  Licht im alten Haus" (`stories_leuchtturmfenster_2/4`) sat on the
  treehouse picture with nothing in the pools to replace it; the owner
  generated a new illustration the same day — a girl and her father in
  an old room, a glass on the windowsill throwing a spot of sunlight on
  the wall — bundled as `light_old_house` (cropped square and reduced to
  512 px like the rest), so no `mismatch` remains. Twelve story pictures
  that do match are now `verified`. Verified: all five languages' story
  cells cycled through the real app (every text fits one page, no
  console errors), `npm test`, `verify-docx` 11/11 (incl. the edited
  Slovene level 5 and French level 3), `verify-offline`, `verify-firefox`.
- **Child-name field removed.** The sidebar's "Child's name (optional)"
  box and the `{name}` placeholder behind it are gone. Only the 11 story
  entries (7 English, 4 Slovene) ever used it, and a typed name of the
  other gender made the text wrong: English stories say "she", and
  Slovene puts gender into the verbs and adjectives themselves (*je
  preživljal*, *je čakal*, *naj bo potrpežljiv*), so "Ana je poletje
  preživljal" was one keystroke away. Fixing that properly means a second,
  fully authored version of every story, forever; the owner chose to
  drop the field instead. The 11 texts now carry the name they already
  showed by default (Mia/Tom) written out — the rendered worksheet is
  unchanged, so no `version` bump — and `name_default` /
  `name_default_syllables` are no longer part of the schema (an entry
  that still has them is accepted and the fields ignored; a body that
  still contains `{name}` is rejected). Saved setups never held the name,
  so nothing stored by a teacher is affected. Removed with it:
  `resolvePersonalization`, `DEFAULT_CHILD_NAME`, two locale strings in
  each language, the `name` step in `verify-docx`.
- **English stories: three texts per level.** Ten original English
  stories (two per level, 34–185 words) written for pictures already in
  the bundle — the wet kitten, the leaf boat, the kite in the oak, the
  red mitten, the snail race, the garden gate, the treehouse, the silver
  key, the kitten's new home, the chest in the cellar — so the pack grows
  without new assets. Each fits one page at default settings (checked in
  real Chromium), follows the English syllable convention, and is marked
  `imageAccuracy: verified`. The other four themes follow.
- **English animal facts: three texts per level** (2026-09-21). Ten
  original texts (34–187 words) for bundled pictures: the owl at night,
  the tortoise's shell, busy bees, the giraffe's tongue, the dolphin's
  signature whistle, the octopus that opens a jar (what the
  `octopus_camouflage` picture actually shows), how bats hunt with
  echoes, the axolotl that never grows up, how dolphins see with sound,
  and the blue whale. Facts checked against standard references (blue
  whale ≈ 30 m and ~4 tonnes of krill a day, giraffe tongue ≈ 45 cm,
  dolphin dives up to ~10 minutes, axolotl range and regeneration, wild
  axolotls dark / pink ones captive-bred). Same checks as the stories:
  every one of the fifteen `animal_facts` titles fits one page at
  default settings in real Chromium, syllable breaks follow the English
  convention, `imageAccuracy: verified`. Written without the `{name}`
  placeholder (removed the same day).
- **English around the world: three texts per level** (2026-09-21). Ten
  original texts (32–189 words) for bundled pictures: the pyramids of
  Giza, Dutch windmills and tulips, Venice (a level-2 introduction and a
  level-5 text on the wooden piles it stands on, the vaporetti and the
  flood gates), a hilltop castle, the Pont du Gard, the Sahara, the moai
  of Rapa Nui (with the "walking statues" experiments), Uluru (higher
  than the Eiffel Tower, the Anangu, the climb now closed) and the Amazon
  rainforest. Facts checked; two popular claims were replaced because
  they are wrong (Uluru is not "higher than the tallest skyscraper"; the
  red-eyed tree frog is Central American, so the Amazon text just says
  "tree frogs"). All fifteen `around_the_world` titles fit one page at
  default settings in real Chromium.
- **English amazing science: three texts per level** (2026-09-21). Ten
  original texts (33–188 words): a rainbow at level 1 and how a raindrop
  makes one at level 3, the echo, gravity, the first ice on a puddle
  (with the "never test pond ice alone" note the picture asks for), the
  sundial, tide pools, how the pyramid blocks were moved (wet sand,
  sledges, ramps, levers), the journey of a river, and why ice floats.
  The planned third rainbow picture was swapped for `reka` — all four
  bundled rainbow pictures are the same scene, and the river picture
  tells its own story. All fifteen `amazing_science` titles fit one
  page at default settings in real Chromium.
- **English nature and seasons: three texts per level — the English
  pack is complete at 75 entries** (2026-09-21). Ten original texts
  (35–185 words): from seed to sunflower, the wind we cannot see, the
  squirrel's winter store, the arctic fox's white coat, where rain
  comes from, geese flying south, the hedgehog's winter sleep, why
  leaves change colour (Mia and Tom carrying apples), the fungus web
  under the forest (with the "never eat a wild mushroom unchecked"
  note the fly agaric in the picture asks for), and why we have
  seasons. Three pictures were bundled from the owner's new image drop
  because they fit better than the planned ones: `wind_turbines`,
  `arctic_fox_winter`, `autumn_apples` (+~240 KB). Every English theme ×
  level cell now offers three titles; all fifteen `nature_seasons`
  titles fit one page at default settings in real Chromium.
- **Title picker and predictable "Create text"** (upgrade blueprint v3,
  workstream I7, unblocked by the above). When a theme and level offer
  more than one text, a "Text" list above the button shows every title;
  choosing one shows it at once, and "Create text" now moves to the
  *next* title in pack order (wrapping around) instead of picking at
  random. The list is hidden while a cell has a single text, so nothing
  changes for the other languages yet. `verify-docx` cases can pin an
  `entryId`; the three English cases do.
- **Syllable breaks re-checked in English, German, French and Spanish.**
  Every unique word in the 100 non-Slovene entries was checked against the
  per-language rules now written down in `docs/content-guide.md`
  ("Syllable breaks — the convention per language"); 62 breaks in 28
  entries were wrong and are fixed, version bumped on each. French had
  the one systematic error (`feu|il|le` for `feuil|le`, plus a few vowel
  groups split apart: `seu|ils`, `res|pec|tue|ux`, `con|tri|bu|é`);
  English had the most (`ve|ry`, `ma|ny`, `eve|ry`, `op|en`, `ti|red`,
  `Ser|en|ge|ti`, `smal|ler`, …); Spanish one (`cri|a|dos`); German two
  (`-tion` → `-ti|on`). Slovene was left alone — it has been reviewed by
  a teacher. Verified: `npm test`, `npm run validate-content`, every
  edited entry rendered with syllable separators in real headless
  Chromium, and `npm run verify-docx` (11/11).

## 0.8.1-rc.1 — 2026-09-20 (post-review fixes)

Driven by the project owner's independent review of the shipped 0.8 code.

- **Packet snapshots are now real snapshots.** `buildWorksheet()` stored
  the live settings object by reference, so every sheet added to a packet
  silently followed any font/spacing/mode change made afterwards, at print
  time, while its frozen layout still described the old settings. Settings
  are now deep-copied into each model; a unit test mutates every field
  after building to prove it; `verify-firefox` has a real check that
  changing settings after building a packet leaves the packet untouched.
- **Two "browser engine bugs" retracted.** The "Firefox Gecko pagination
  bug" documented since Phase 7 was a defect in the Firefox verification
  script (a once-only DOM freeze that was never restored, so the second
  packet check printed the stale first packet). The "Chromium packet
  truncation bug" documented with 0.8 was the snapshot bug above. Each was
  reproduced and then made to disappear by its fix alone. See
  `docs/compatibility.md`, "Corrected on 2026-09-20".
- **Verification scripts hardened.** `verify-docx`: a case whose export
  never happened now fails the run, every expected artifact is required,
  and the complete rendered title and passage must be present in the PDF
  (not merely "some text"). `verify-offline`: actually exports DOCX (it
  had only pressed Print) and tracks the download to a real file on disk.
- **Reset image** re-renders the worksheet (it only cleared state before,
  so a DOCX exported right after still embedded the custom image).
- **Built-in presets are formatting-only.** Loading Standard or
  Dyslexia-friendly keeps the current language, theme, level and text
  (they used to switch the app back to Slovene and replace the text);
  teacher-saved setups still restore everything. Preset names re-translate
  on language switch. The Dyslexia button and the built-in preset share one
  code path.
- **DOCX line spacing matched the font, not the preview.** Body
  paragraphs used Word's "auto" line rule (a multiple of the font's own
  line height — 1.61em for Andika) where the preview multiplies the font
  size; with the real fonts installed, every page-filling read-copy
  worksheet spilled onto a second page. Hidden for two releases because
  the development machine had none of the bundled fonts and LibreOffice's
  substitute happened to fit. Now an EXACT rule in twips of the font
  size; `verify-docx` runs LibreOffice against the bundled fonts through
  a private fontconfig (6 of 11 cases failed on the old exporter that
  way), and the one page-count tolerance it used to carry is gone.
- **CI.** `.github/workflows/ci.yml`: unit tests/validation/build on every
  push, then the LibreOffice+Chromium and Firefox verification scripts as
  separate real-environment jobs; the scripts take `CHROMIUM_BIN` /
  `SOFFICE_BIN` / `FIREFOX_BIN` overrides. All three jobs green on
  GitHub-hosted runners as of 808cd0b.
- **Line stripes no longer block the worksheet.** From 0.8 (the
  multi-page work) until now, switching "alternating stripes on the
  lines" on made the fit check report WIDTH_OVERFLOW and blank the
  worksheet: the new page-wide width check took the stripes' deliberate
  2mm decorative bleed for an unbreakable word. The check now looks at
  the text blocks only. Found while driving every settings control after
  the `main.js` split; `verify-offline` now toggles stripes and, as the
  counterpart, imports a text with a 160-letter word to prove the real
  WIDTH_OVERFLOW still fires.
- **Content quality is measurable.** Each entry's `review` object records
  who reviewed it, when, whether they were a native speaker, whether the
  syllable breaks were checked, and whether the picture was verified to
  match. `npm run content-status` reports it per language (today: 0/100
  native-reviewed, 9/125 images verified). `docs/content-guide.md` (new)
  documents the levels, the entry schema and the review fields.
- **`main.js` split** into four `src/ui/*` coordinators (packet, presets,
  content import, settings panel), one verbatim move per commit, each
  gated by all three verify scripts; `verify-offline` gained a real
  teacher-content-import check because nothing had covered it.
- **README/CHANGELOG split**; dangling references to the private
  `Instructions/` folder removed.
- **UI polish:** the off-screen print copy is `aria-hidden`; a note under
  the export buttons says which format preserves layout; the fit status is
  plain language instead of millimetres; each level shows its word band;
  Print/Export stay pinned while scrolling settings; the preview scales to
  fit narrower screens.
- **Post-0.8 review fixes:** the page-break preview marker is localized
  (it was hardcoded English); the dead `packet.empty` key is wired up; DOCX
  content width derives from the margin setting instead of a hardcoded
  170mm; `savePreset()` validates before writing; unit tests added for
  `layout/imageBox.js` and `export/print.js`.
- MIT `LICENSE` added for the project's own code, with the licensing scope
  (fonts, images, content text) documented in the README.

## 0.8.0-rc.1 — 2026-09-20

- **Content:** 25 entries per language (5 themes × 5 levels) for Slovene,
  English, German, French, and Spanish — 125 entries total, all
  schema-validated (unique ids, valid image references, syllable/body
  consistency), each entry carrying a `version` (see "Content versioning"
  below). Slovene is the original curated selection.
  **English/German/French/Spanish have now had a close editorial pass**
  (grammar, natural phrasing, factual accuracy, syllable-break correctness
  — see the git history):
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
- **Multi-page worksheets:** the old one-page-only hard block (a
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
  case has. (The 0.8 release notes here originally described a "Chromium
  print-engine bug" affecting packets that mix multi-page and single-page
  sheets. It was an app bug — packet snapshots shared the live settings
  object — fixed in 0.8.1; see "Packet snapshots" below.)
- **Packet snapshots (fixed in 0.8.1, kept here for context):** `buildWorksheet()`
  stored the live settings object by reference, so every sheet added to a
  packet silently followed any font/spacing/mode change the teacher made
  afterwards, at print time, while its frozen layout still described the
  old settings. That mismatch was what had been mis-documented as a
  Chromium bug in 0.8 and — via a separate defect in the Firefox
  verification script — as a "Gecko engine bug" since Phase 7. Both
  writeups are corrected in `docs/compatibility.md` ("Corrected on
  2026-09-20"); the settings are now deep-copied into each model, a unit
  test mutates every field after building to prove it, and
  `verify-firefox` has a real (failing, not informational) check that
  changing settings after building a packet leaves the packet untouched.
- **Personalization default name:** a text using `{name}` (7 entries:
  4 Slovene, 3 English) used to blindly delete the placeholder when the
  teacher left the name field empty, producing broken sentences (e.g. "Was
  spending the summer..."). Every such entry now carries a required
  `name_default` (validated at import time), used automatically whenever
  the field is empty — a typed name still overrides it, exactly as typed,
  with no grammar adjustment. Fixed the related bug where syllable coloring
  was silently dropped on any personalized passage; it's now preserved
  around the substituted name in both cases. Slovene's masculine-verb-form
  entries use "Tom" as their default; the rest use "Mia".
- **Favorites removed:** the bookmark-a-text feature was removed
  (teachers weren't using it, per the project owner). Saved setups/presets
  and setup export/import are unaffected. "Reset saved data" still cleans
  up the old favorites key on a browser profile left over from a pre-0.8
  install.
- **DOCX fixes:** the exported image used to be forced into a fixed
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

### Phase 7 (release qualification)

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
- **Real Firefox compatibility — automated, passing.** Firefox doesn't
  speak Chrome DevTools Protocol — it speaks WebDriver BiDi — so `npm run
  verify-firefox` uses `geckodriver` + `selenium-webdriver` instead. Covers
  the same broad journey as the Chromium checks, plus single-worksheet,
  multi-page and packet printing verified via WebDriver's real
  `printPage()` command (Firefox's actual print engine). From Phase 7 to
  0.8.1 this bullet described a "reproducible Firefox-only Gecko bug"
  (extra blank pages after prior re-renders). It was a defect in the
  verification script itself, not Firefox — see `docs/compatibility.md`,
  "Corrected on 2026-09-20".
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

## 0.7.0-rc.1 — 2026-09-19 (Phases 0–7)

One commit per phase, oldest first — see `git log`:

- Phase 0: technical proof (double-click `file://` launch, bundled font and
  image, colored Slovene text, one A4 PDF, editable DOCX).
- Phase 1: settings validation, content schema, i18n scaffold, build gate.
- Phase 3 (parts 1–5): 25-entry Slovene content set with real theme/level
  UI; dyslexia-support settings panel; child-name personalization; named
  setup save/reload; custom image upload. (Phase 2, the first end-to-end
  worksheet, was folded into Phase 3's first commit.)
- Phase 4 (parts 1–3): syllable separators, sentence-per-line, trace mode,
  tint; Lexend, OpenDyslexic and Comic Neue bundled; zebra line striping
  from real measured line boxes. Country-specific handwriting rulings
  remain open, blocked on real classroom samples.
- Phase 5: multi-language support (sl/en/de/fr content and UI, runtime
  language switching); Spanish added as a fifth language, and a
  DOCX header-locale bug (hardcoded Slovene "Ime:/Datum:") found and fixed
  by testing Spanish export end-to-end.
- Phase 6: favorites, packets, content import UX, setup portability,
  Reset, teacher guide.
- Phase 7: real LibreOffice testing, fresh-machine offline check, licenses,
  versioned ZIP; real Firefox testing via geckodriver + selenium-webdriver.
- Content review pass over EN/DE/FR/ES (6 syllable-break fixes); DE/FR
  level-5 page overflow fixed by trimming 10 entries; image licensing
  resolved; the 4 outright-mismatched images replaced with new artwork.
