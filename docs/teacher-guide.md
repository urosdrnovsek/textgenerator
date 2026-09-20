# Teacher guide

This guide explains how to use the Writing Worksheet Generator day to day —
making a worksheet, using the reading/writing supports, saving your own
setups, building a set of several worksheets to print at once, and adding
your own texts. It doesn't require any technical background.

## Opening the app

The app is a single folder (`release/`, or the folder you were given).
Open `index.html` inside it by double-clicking, or dragging it into a
browser window. No internet connection is needed at any point — everything
the app needs is already inside that folder.

## Making a worksheet

1. **Language** — choose the language of the text and of the interface.
2. **Theme** — Stories, Animal facts, Around the world, Amazing science, or
   Nature & seasons.
3. **Level** — 1 (shortest, simplest) through 5 (longest, most complex);
   each option shows the approximate word count it aims for. The app shows
   how many texts are available for your current theme+level combination
   before you create anything.
4. Click **Create text**. The app picks one matching text (never the same
   one twice in a row if others are available) and shows a preview on the
   right. Changing the theme or level afterward does *not* change what's
   shown until you click **Create text** again — so you can safely explore
   filters without losing your current worksheet.
5. When you're happy with the preview, use **Print / Save as PDF** or
   **Export as Word (.docx)** at the bottom of the sidebar (they stay in
   view while you scroll the settings). Print / PDF keeps the layout
   exactly as previewed; Word is editable and may reflow slightly in your
   word processor.

### When a worksheet is longer than one page

One page is still the goal, and most combinations of text, level, and
settings fit on one. If a particular combination doesn't — a long level-5
text with a large font and generous spacing, for example — the sidebar
tells you it will print on more than one page instead of stopping you.
Print and Word export both stay available; the preview shows a dashed
line with a page number wherever the app expects the print to break.

If you'd rather keep it to one page, the sidebar suggests what to try:
a shorter text, a smaller image, more compact spacing, or switching to
"Read only" mode (which needs less space than "Read & copy").

A worksheet can also occasionally be impossible to lay out at all — a
single word wider than the page, for instance, or an image/header taller
than a page. That's rare, and in that case the sidebar explains exactly
what's wrong; Print and Word export stay disabled until you change
something.

## Reading and writing supports

Open **Text settings** to adjust:

- **Font** — including dyslexia-friendly options (Andika, OpenDyslexic,
  Comic Neue) alongside a plain sans-serif (Lexend).
- **Font size, line spacing, letter spacing, extra word spacing.**
- **Confused-letter colors (b/d/p/q)** — colors commonly mirrored letters
  so children can tell them apart at a glance.
- **Syllable colors** and/or **syllable separators** (Ma·ja) — shown
  independently, so you can use either, both, or neither.
- **One sentence per line** — helps a child keep their place.
- **Background color** and **alternate-line stripes** — both screen
  options you can also choose to print (off by default, to save ink).
- **Header fields** — turn the name line, date, and title on or off
  independently.
- **Handwriting line height** — how tall each ruled line is in read & copy
  mode.

The **Dyslexia-friendly** button applies a sensible starting combination of
these in one click; every option remains individually adjustable
afterward.

**Writing mode**, just above Text settings, switches between:
- **Read & copy** — the text at the top, ruled handwriting lines below.
- **Trace** — the text shown lightly, for tracing over.
- **Read only** — just the text and picture, no handwriting lines.

**Child's name** (optional) personalizes a text that supports it. Type any
name and it's used exactly as typed. Leave it blank and the text uses its
own built-in default name instead (shown as the box's example text, e.g.
"e.g. Mia") — texts never print with the name missing. A name you type is
inserted exactly as written, with no grammar adjustment, so pick one that
fits the sentence if the wording reads a little oddly with an unusual name.
**Custom image** lets you swap in your own picture (PNG or JPEG) for this
one worksheet; it's not saved anywhere and resets the next time you create
a new text.

## Saved setups (presets)

Once you've got a combination of language, theme, level, font, and support
settings you like, open **Saved setups** and click **Save current setup**
to name and keep it. **Load** brings a saved setup back at any time;
**Delete** removes one (the two built-in setups — Standard and
Dyslexia-friendly — can't be deleted, only used as a starting point).

The two built-in setups change only the formatting: loading one keeps
your current language, theme, level and the text you're looking at. A
setup you saved yourself restores everything it was saved with, including
the language and the theme/level, and creates a text for them — that's
what saving a setup is for.

A saved setup does **not** include a child's name or a custom image — those
stay specific to the one worksheet you were making, not the reusable setup.

### Backing up and restoring your setups

Saved setups live only in this browser, on this computer. Under **Backup /
restore setups**:

- **Export my setups** downloads a small `worksheet-setups.json` file
  containing everything you've saved. Keep it somewhere safe (a USB drive,
  a shared drive, cloud storage) — it's the only way to move your setups
  to a different computer or restore them if this one is reset.
- **Import setups (.json)** brings a previously exported file back in.
  Importing never deletes what's already saved; if a setup with the same
  internal id already exists, the imported copy gets added as a new one
  rather than overwriting it.

**Reset saved data**, further down, deletes every setup saved on this
computer (after asking you to confirm) — useful before handing the computer
to someone else, or if something looks wrong and you want a clean slate. It
only touches this app's own saved data, nothing else on the computer.

## Printing several worksheets at once (packets)

To prepare a whole set — say, one worksheet per pupil, or a few different
levels for one lesson — use the **Packet** panel:

1. Build each worksheet as usual, then click **Add to packet**. The
   worksheet you see at that moment is captured exactly as it is; changing
   settings afterward won't change sheets already added.
2. Repeat for every worksheet you want in the set (up to 20 sheets).
3. Reorder with the **↑ / ↓** buttons next to each sheet, or remove one
   with **✕**.
4. Click **Print packet** — this opens the normal print dialog with every
   sheet as its own page(s), in the order shown, ready to print as one job.
5. **Clear packet** empties the whole set when you're done with it.

The packet is not saved between sessions — it's meant for "build a set, print
it now."

## Adding your own texts

Under **Add new content**, a teacher (or whoever maintains the school's
content) can add new texts without changing any code:

1. Prepare a JSON file describing one or more texts for a single language,
   following the same structure as the files already bundled in
   `content/*.json` — copy an existing entry as a starting point. If your
   text should address the child by name, use `{name}` in the text exactly
   like the bundled examples do, and also fill in `name_default` (the name
   used whenever a teacher leaves the name field blank) — an entry using
   `{name}` without a `name_default` is rejected on import.
2. If the new texts use pictures that aren't already in `assets/images/`,
   select those image files too (PNG or JPEG). Each new text's `imageId`
   in the JSON should match its image's filename without the extension
   (for example, an image file named `octopus.jpg` is referenced as
   `"imageId": "octopus"`).
3. Click **Import**. The whole file is checked before anything changes —
   if any entry has a problem (a missing field, an unknown theme, a
   picture that wasn't provided), you'll see exactly which entry and what's
   wrong, and *nothing* is changed. If it's valid, the imported texts
   **replace** the previously loaded texts for that language for the rest
   of this session.

Imported content is **not written back to disk** — it only lasts until you
close the app. This keeps `content/*.json` on disk as the one place new
texts are permanently added (by editing the file itself and rebuilding the
app), while still letting you try a new set of texts immediately without
any technical steps.

## What still needs a developer

A few things in the roadmap aren't available yet and need someone to
extend the app's source rather than something you can do from this
interface: country-specific handwriting rulings beyond the current generic
three-line guide, and font embedding in exported Word files (Word/
LibreOffice substitute a fallback font if the chosen one isn't installed on
that computer). Neither affects PDF printing, which always uses the
correct font.
