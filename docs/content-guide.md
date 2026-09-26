# Content guide

How the bundled texts are organised, what each field in `content/*.json`
means, what the five levels are supposed to be, and how a review is
recorded so that `npm run content-status` can report it. This is the
maintainer's companion to `docs/teacher-guide.md` (which covers the
no-rebuild import path from the teacher's side).

## Packs and the theme × level grid

One file per language: `content/sl.json`, `en.json`, `de.json`, `fr.json`,
`es.json`. Each is a *pack*:

```json
{
  "schemaVersion": 1,
  "packId": "starter-en",
  "language": "en",
  "entries": [ … ]
}
```

The app offers five themes (`stories`, `animal_facts`, `around_the_world`,
`amazing_science`, `nature_seasons`) and five levels. **Every theme × level
cell should have at least one entry** — an empty cell is exactly what a
teacher sees as "No texts for this selection" (the app never quietly
substitutes another level). Slovene, German, French and Spanish have
exactly one entry per cell, 25 per language; English is being grown to
three per cell so a class doesn't get the same text twice (stories done
on 2026-09-20 — ten original texts on already-bundled pictures — the
other four themes to follow). Within a cell the app offers the titles in
a picker and "Create text" cycles through them in pack order, so **new
entries go at the end of the file**: the first entry of a cell is what a
teacher sees first, and what the verify scripts get unless they pin an
`entryId`. `npm run content-status` prints the grid and flags empty
cells.

## Levels

Level is an *editorial* target, not a validated reading measure — word
counts are not comparable across languages, and the app never presents
them as an assessment. The bands are what the level selector shows the
teacher ("1 — very short, ~20–40 words"), so keep new entries inside them.

| Level | Words | Sentences | Assumed knowledge |
| --- | --- | --- | --- |
| 1 | ~20–40 | Very short and simple: one clause, present tense, no subordinate clauses. | Everyday words a beginning reader already uses aloud. |
| 2 | ~40–70 | Short; an occasional "and"/"but"; still mostly present tense. | Familiar settings (home, school, garden, pets). |
| 3 | ~70–110 | Medium; simple subordinate clauses ("when", "because"); past tense appears. | One new fact or word per paragraph is fine if the text explains it. |
| 4 | ~110–160 | Longer sentences with two clauses; a little descriptive vocabulary. | Some general knowledge (a country, an animal habitat) can be assumed. |
| 5 | ~160–220 | The longest; varied sentence length and connectives; fills a page. | A confident reader; specialised words are allowed when the context carries them. |

Word count is computed on the resolved text (placeholders filled in,
syllable separators removed). Level 5 is also where page fit gets tight:
under the app's *default* settings, a level-5 entry with a picture should
still fit on one page — the German and French level-5 entries had to be
trimmed once for exactly that reason, and two of them are permanent cases
in `scripts/verify-docx-libreoffice.mjs`. Longer texts are allowed (the
worksheet extends to a second page and says so), but one page is the
target for bundled content. Count paragraph breaks when checking fit: a
new paragraph starts a new line, so a level-5 text with paragraphs needs
more height than the same words run together.

## Entry schema

Copy an existing entry; the validator (`src/content/validate.js`) rejects
anything that doesn't fit, with the entry id and field named, both at
build time (`npm run validate-content`, run by `npm run build`) and on
teacher import.

```json
{
  "id": "stories_piscancek_2",
  "version": 2,
  "theme": "stories",
  "level": 2,
  "title": "The White Egg",
  "body": "Mia was spending the summer at Grandma's farm. …",
  "syllable_body": "Mi|a was spend|ing the sum|mer at Grand|ma's farm. …",
  "imageId": "piscancek_gnezdo",
  "review": {
    "status": "reviewed",
    "reviewer": "Claude (AI editorial pass, not a native speaker)",
    "date": "2026-09-19",
    "nativeSpeaker": false,
    "syllablesReviewed": true,
    "imageAccuracy": "plausible"
  }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique within the pack. Convention: `<theme>_<topic>_<level>`. Don't rename an id once shipped — the "no immediate repetition" logic and every worksheet's content key refer to it. |
| `version` | yes | Positive integer. **Bump it whenever the text is corrected** (a fixed typo, a trimmed sentence, a re-checked syllable break). New entries start at 1. |
| `theme` | yes | One of the five theme ids above. |
| `level` | yes | Integer 1–5. |
| `title` | yes | Printed as the worksheet heading (when the header's title field is on). |
| `body` | yes | The passage, as one flowing text (the bundled entries use no line breaks). No placeholders — a `{…}` in the text is rejected. |
| `syllable_body` | no | `body` with `\|` between syllables (`sum\|mer`). With the separators removed it must reproduce `body` *exactly*, character for character — the app checks this. Needed for the syllable-colour and syllable-separator supports; without it those supports render the entry unmarked. |
| `sentences` | no | The body split into sentences. Joined with single spaces they must reproduce `body` exactly. Validated and carried through, but the app does not use it yet: "one sentence per line" currently splits `body` on sentence punctuation. Leave it out. |
| `imageId` | yes | The id of an image in `assets/manifest.json` (for teacher imports: the image filename without extension). Every entry has a picture. |
| `review` | yes | Review provenance — see below. |

### The child in a story

A story that follows a child names the child in the text like any other
word. Project rule: **Tom for a boy, Mia for a girl** (syllables `Tom`,
`Mi|a`). Until 0.8.1 the packs used a `{name}` placeholder that a teacher
could fill in from a "Child's name" field; that was removed because a
name of the other gender made the text wrong — pronouns in English, and
gendered verb and adjective forms in Slovene (*je preživljal*, *je
čakal*), which no substitution can fix. Older entries with `{name}` and
`name_default` are rejected by the validator; write the name out.

### Syllable breaks — the convention per language

`syllable_body` marks *reading* syllables (what a child sounds out), not
typographic hyphenation points. Every non-Slovene entry was re-checked
word by word against these rules on 2026-09-20 (Slovene was reviewed by
a teacher and is not covered here); apply the same rules to new entries.

- **Spanish** — RAE rules. Diphthongs (`ai`, `ia`, `ue`, `ui`, `io`…) and
  triphthongs never split (`cria|dos`, `cui|da|do`); a written accent on
  the weak vowel makes a hiatus (`dí|a`, `ba|úl`); two strong vowels
  split (`le|er`). `ch`, `ll`, `rr`, `qu`, `gu(e/i)` are single units; a
  consonant + `l`/`r` opens the next syllable (`ha|blar`); other pairs
  split (`car|ta`), and in a three-consonant group `s` closes the first
  syllable (`cons|tan|te`, `ins|tru|men|to`).
- **French** — *syllabes écrites*: a silent final `e` (or `-es`, `-ent`)
  makes its own written syllable (`ta|ble`, `chas|sent`), so `ée`/`ées`
  stay whole (`fu|sée`, `val|lées`). A single consonant opens the next
  syllable (`a|ni|mal`); double consonants split (`bel|le`, `pous|se`),
  including `ill` (`feuil|le`, `o|reil|les`, `mouil|le`, `vieil|le`);
  `ch`, `ph`, `th`, `gn` and consonant + `l`/`r` never split (`ta|ble`,
  `mon|ta|gnes`); `ck` does (`stoc|kées`). Vowel groups stay together
  (`seuils`, `res|pec|tueux`, `si|nueu|ses`, `con|tri|bué`) except a
  diaeresis or an accented vowel next to another vowel (`No|ël`,
  `ré|ac|tion`, `gé|an|te`, `No|é`); `y` between vowels opens the next
  syllable (`vo|ya|ge`, `dé|plo|yées`).
- **German** — Duden (2006 rules): one consonant to the next syllable
  (`Wa|gen`), of several only the last (`Was|ser`, `Müt|ze`, `Fens|ter`);
  `ch`, `sch`, `ck`, `ph`, `ß`, `qu` never split (`Zu|cker`, `wa|schen`);
  compounds and prefixes split at the morpheme (`Wind|stoß`,
  `ver|las|sen`, `hin|aus`); `-tion` is two syllables (`Si|tu|a|ti|on`);
  a single leading vowel is its own syllable (`E|le|fant`, `ü|ber`,
  `Ei|er`).
- **English** — the reading-instruction division that dictionaries also
  use: split between two consonants (`win|ter`), never inside a digraph
  (`rath|er`, `fish|ing`); an open syllable before a long vowel (`ti|ny`,
  `o|pen`, `spi|ral`, `lo|cate`), closed before a short one (`ver|y`,
  `man|y`, `bod|y`, `ev|ery`); consonant-`le` (`sin|gle`, `lit|tle`);
  prefixes and suffixes kept whole (`de|spite`, `be|yond`, `re|sist`,
  `small|er`, `dif|fer|ent|ly`); a stem's silent `e` goes with `-es`
  (`fac|es`, `chang|es`, `ex|pe|ri|enc|es`); place names by pronunciation
  (`Se|ren|ge|ti`, `Tan|za|nia`, `Cap|pa|do|cia`); `tired` is one syllable.

## Images

Each `imageId` points at `assets/manifest.json`, which records the file,
its size and its license. Every bundled image is original artwork made by
the project owner (see `THIRD_PARTY_NOTICES.md`); a new image needs a
manifest entry with the same fields. The picture is part of the
worksheet, so it should show what the text is about — a child reads the
picture first. Whether anyone has actually confirmed that is recorded
per entry in `review.imageAccuracy` (below), because for most non-Slovene
entries the image was *reassigned* from another entry on topic
similarity, not drawn for the text.

## Review provenance

`review.status` is required and gates nothing yet in the app (drafts
render like reviewed entries), but it is the honest record of what the
content has been through. The optional fields exist so that quality is
*measurable* — `npm run content-status` aggregates them per language —
instead of asserted in a README paragraph.

| Field | Values | Record it when… |
| --- | --- | --- |
| `status` | `draft` / `reviewed` / `rejected` | Always. `reviewed` means someone read the whole passage for grammar, natural phrasing and (for facts) accuracy. `rejected` is meant to keep an entry in the file but out of use — the app does not filter on it yet, so a rejected entry is still served; delete it instead. |
| `reviewer` | free text | Who reviewed it: a person's name or role, or, honestly, `"Claude (AI editorial pass, not a native speaker)"`. |
| `date` | `YYYY-MM-DD` | When that review happened. |
| `nativeSpeaker` | `true` / `false` | Whether the reviewer is a native speaker of the pack's language. This is the number the project is waiting on: an AI editorial pass is careful but *is not* a native speaker's read. |
| `syllablesReviewed` | `true` / `false` | Whether every `\|` in `syllable_body` was checked, not just the prose — the six errors found in 2026-09 were all syllable breaks (`qu` digraphs, a compound boundary, a monosyllable split). |
| `imageAccuracy` | `verified` / `plausible` / `mismatch` | `verified`: someone looked at the picture next to the text and it shows the subject. `plausible`: topically reassigned or never checked. `mismatch`: known wrong — fix it or replace the image; don't ship it. |

Rules of thumb:

- A native speaker's review of an existing `reviewed` entry replaces the
  `reviewer`/`date`/`nativeSpeaker` fields; it does not need a `version`
  bump unless the text changed.
- When you correct text, bump `version` **and** re-record the review —
  the old review no longer describes the new text.
- Set `imageAccuracy` independently of the text review; it's a different
  check, and often a different person.

### Where the content stands (2026-09-26)

From `npm run content-status`:

- **Slovene:** 80 entries. The original 25 (`draft` — written by the
  project owner, never formally reviewed; their story pictures were
  checked on 2026-09-21) plus 50 curated on 2026-09-21 from the raw pool
  `Texts collection/sl_texts.json`, two per cell, after a Slovene teacher
  had reviewed that pool and their corrections were applied (`d9c1183`).
  Those 50 are `reviewed`, `nativeSpeaker: false` (the teacher's review
  covered the pool, not these entries as such, and only part of the pool
  for certain), `syllablesReviewed: false` (the pool's syllable breaks
  were never separately checked). Pictures: 33 already bundled, 17
  bundled from the raw `Images/` pool for this; the science texts, which
  have no pool pictures at all, were matched to bundled pictures by
  topic (magnets, echo, arch bridge, seed, moon phases). The eight
  non-story level-5 texts (and the owner's Venice text) each lost one to
  three sentences to fit one page — Slovene words are long, and the
  level-5 pool texts ran to 1,050–1,170 characters.
- **A fifth round of stories, every language (2026-09-26):** five
  pictures drawn for the owner were bundled (`family_soup`,
  `winter_postman`, `music_rehearsal`, `lighthouse_rescue`,
  `fire_station`) and every language got one original story per level
  on them, in that order from level 1 to 5 (the lighthouse is level 4
  because English level 5 already had one). Each text was written for
  its picture (`imageAccuracy: verified`) and fits one page in
  read-and-copy mode. The Slovene five are `draft` until the owner has
  read them; the English, German, French and Spanish five are recorded
  like those languages' earlier rounds (`reviewed`, not a native
  speaker). German level 5 had to lose a paragraph break to keep its
  copy lines on page 1. Generators: `Instructions/tools/*-round3-stories.py`
  (gitignored).
- **English:** 98 entries — three per theme × level cell, four in the
  story, animal and science cells and in three more (nature L2/L3,
  around the world L4). The 25 below plus fifty original texts (ten per
  theme, two per level; stories on 2026-09-20, the other four themes on
  2026-09-21), each written for the picture it is paired with
  (`imageAccuracy: verified`); then a second round (from 2026-09-21) adds
  a fourth text wherever one of the owner's new pictures fits — stories
  first (`storm_dog`, `blanket_fort`, `library_map`, `pottery_wheel`,
  `mountain_camping`), then animals (`hummingbird`, `red_panda`,
  `sea_turtle_cleaners`, `orangutan`, `humpback_calf`) and science
  (`solar_oven`, `electric_circuit`, `ammonite_fossil`,
  `backyard_telescope`, `mars_rover`), and finally `sunflower_planting`,
  `tree_frog` and `roman_mosaic`. Round 2 is complete: every picture in
  the drop that fitted a cell is used; the five story-like pictures left
  over (music rehearsal, fire station, vegetable soup, winter postman,
  lighthouse keeper) were bundled in the fifth round above, so English
  stories now have five texts per level.
- **French:** 55 entries (with the fifth round above) — the 25 below plus, from 2026-09-21, one
  original French text per theme × level cell on the topic and picture
  of the matching Slovene entry (the kitten, the egg, the snail race,
  the owl, the bee, the dolphins, the pyramids at four levels, Venice,
  the rainbow at four levels, gravity, the seed, the rain, the wind, the
  autumn leaves, the seasons; the one exception is animal L4, where the
  pack already had the bat, so the octopus-and-jar picture is used).
  Written in plain French and syllabified with the project's
  *syllabes écrites* splitter (`Instructions/tools/fr.py`, gitignored),
  then reviewed word by word; `ée` kept whole per the convention.
  `imageAccuracy: verified`, `nativeSpeaker: false`.
- **German:** 55 entries (with the fifth round above) — the 25 below plus, from 2026-09-21, one
  original German text per cell on the Slovene topics and pictures, the
  same way as French (Lena and the kitten, the egg, Theo the snail; the
  owl, the bee, the dolphins, the bat; the pyramids at four levels and
  Venice; the rainbow at four levels and gravity; seed, rain, wind,
  autumn leaves, seasons). Syllabified with the Duden-pattern splitter
  (`Instructions/tools/de.py`) plus a short override list where the
  patterns disagree with the pack's rules (`ein|an|der`, `E|cho`,
  `E|cke`, `Pha|ra|o|nen`, `Vi|o|lett`, `dar|ü|ber`), then reviewed.
  German level-5 texts are kept to ~150–175 words because German words
  are long — one Venice text had to be trimmed after it ran to a second
  page in the fit check.
- **Spanish:** 55 entries (with the fifth round above) — the 25 below plus, from 2026-09-21, one
  original Spanish text per cell on the Slovene topics and pictures, as
  for French and German (Sofía and the kitten, the egg, Tito the snail;
  owl, bee, dolphins, bat; pyramids at four levels and Venice; rainbow at
  four levels and gravity; seed, rain, wind, the squirrel's winter store
  — the pack already had the autumn leaves in every nature cell — and
  the seasons). Syllabified with the RAE splitter
  (`Instructions/tools/es.py`), which agrees with the reviewed pack on
  every word. The first run of the one-page fit check over the Spanish
  pack found the existing `nature_seasons_hojas_otono_5` running to a
  second page; one redundant sentence was removed (version 2).
- The Slovene `around_the_world_benetke_5` (191 words) ran to a second
  page at default settings; two sentences were removed on 2026-09-21
  (version 2) and every entry in every pack now fits one page.
- **Paragraph breaks now print (0.10, 2026-09-24).** 73 entries contain
  authored paragraph breaks (`\n\n` in `body`). Until 0.10 they were
  lost in every output, so the one-page checks above measured the texts
  without them. With paragraphs shown, 17 level-5 entries still fit
  their *text* on page 1 in read-and-copy mode, but fewer than three copy
  lines remain, so the copy lines move to a second page and the app says
  "will print on 2 pages". The owner accepted this on 2026-09-24 rather
  than trimming the texts. Read-only and trace sheets are unaffected by
  the copy-line rule.
- **English (original 25), German (original 25), French (original 25), Spanish (original 25):** 25 entries each, all `reviewed`
  by an AI editorial pass on 2026-09-19 (`nativeSpeaker: false`,
  `syllablesReviewed: true`; 3 German and 3 French syllable breaks were
  fixed in that pass). A second, word-by-word syllable pass on 2026-09-20
  (every unique word checked against the per-language rules above, with
  rule-based splitters and the Duden/TeX hyphenation patterns as a
  second opinion) corrected 62 more breaks in 28 entries: 1 Spanish, 2
  German, 18 French (mostly `feu|il|le`-type words), 41 English. Native-
  speaker review: **0 of 100.**
- **Images:** 234 of 343 `verified` (the four illustrations generated for
  the mismatched Neuschwanstein, Uluru, Easter Island and Pont du Gard
  entries, the axolotl illustration bundled for the five Spanish ajolote
  entries, the fifty new English texts, the twenty-five fifth-round
  stories, the twelve story pictures
  checked against their texts on 2026-09-21 — see below — and the
  German "Das Licht im alten Haus" pair, which got its own illustration
  the same day: `light_old_house`, a girl and her father in an old room
  with a glass on the windowsill throwing a spot of sunlight on the
  wall); 109 `plausible`; none `mismatch`.
- **Story pictures vs the child in the text (2026-09-21):** every story
  picture was compared with every text that uses it. The three Slovene
  "Tom" stories (`piscancek_2`, `piscancek_4`, `muc_5`) were illustrated
  with a girl, so the texts are now about Mia with feminine verb forms
  (version 3); English `kite_in_tree_1` became Mia and Grandpa; German
  `wollmuetze_1/3` now follow the picture (Leon finds a red mitten, a girl
  comes for it — "Der rote Handschuh"); French `boite_a_musique_1/2` are
  about Léa, `clef_minuscule_4` about Noé; the French bike story got a
  bundled bicycle picture (`bicycle_repair`). Rule for new texts: **look
  at the picture first and match the child's gender to it.**

That 0/100 is the reason the version is still a release candidate.
