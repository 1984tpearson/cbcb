# Working notes for this repo

## Before changing a default in site-config.js — check for a clash

`site-config.js` holds the built-in defaults. The owner edits them through
`settings.html`, which saves **only what differs from those defaults** to the
server. Anything they have not touched keeps following the defaults, so
improving a default normally reaches them automatically.

The exception is arrays, which are stored **whole**, not merged key by key.
Once the owner edits one entry, their saved copy of that entire array takes
over and later changes to the other entries in it silently never arrive.
Stored whole: `sliderDefs`, `reactiveSliderKeys`, every list under `options`,
`models.text` / `models.image`, `appearance.*Tiers`, `chestCups`,
`faceVariationPools`, `appearance.face.groups` (and each field's `options`),
`appearance.face.structure`, `appearance.body.fields`. Merged per key (no clash): `traitTiers`, `prompts`,
`sliderDefaults`, `reactiveMaxDrift`, `models.imageParams`, and the scalar
appearance fields.

**So: before editing a default, read what is actually saved and see whether it
overrides the thing you are about to change.**

```sql
-- via the Supabase MCP tools, project keqzqhykfygplolcnxnn
select data from chats where character_id = '__site_config__';
```

(The data proxy's `get_site_config` action returns the same thing, but
outbound HTTPS to supabase.co is blocked in some sandboxes — the SQL above
works either way.)

**If your change clashes with something they have saved, stop and ask** — do
not quietly ship a default they will never see, and do not overwrite their
saved value on your own. Show them the specific conflict (their value vs. the
new default) and offer the two choices:

- **promote** — make their saved value the new default in `site-config.js`,
  and drop it from the stored overrides so it is no longer an override; or
- **drop** — remove their override so they pick up the new default instead.

Either way they decide, not you. If there is no clash, just make the change.

## Two images per character, and they must never swap

- `referenceImage` — nude, 3/4 length. The **only** image passed to the image
  model, and never rendered. Nude because clothing is decided per scene in
  chat, and a tattoo hidden under clothes in the reference is one the model
  never learns about.
- `avatarImage` — clothed portrait. Rendered everywhere, never sent to the
  model. Read it through `characterAvatar(c)`, which falls back to
  `referenceImage` so characters predating the split still display correctly.

Two images only conflict when both feed the generator, which is why the avatar
is display-only. `backgroundImage` follows the avatar unless deliberately set
to something else.

Chat image prompts say almost nothing about appearance — `buildChatCharDesc`
emits age, gender and height only, because the base image carries the rest and
saying it twice cannot make the image more like itself. The full
`buildAppearancePrompt` still belongs in the three editors that generate a base
image from text, in the `[APPEARANCE]` note the chat model reads, and in the
language-model paths (`extractScene`, `inferScenarioSetup`) that read words
rather than look at the picture.

Tattoos (`appearance.body`) are decided in the body editor and reach chat
images **only as pixels in the base image** — nothing about them enters
`buildAppearancePrompt` or any chat prompt. Do not add them there: the base
image is already the source of truth, and a second one would argue with it.

## Layout

## One set of appearance fields, two screens

`CharacterForm` (create) and `AppearanceEditor` (alter) show the same tabs —
Face, Hair, Body, Tattoos — rendered by `AppearanceTabFields` off
`CFG.appearance.face` and `CFG.appearance.body`. Which tab a group sits on is
its `tab` key in the config, so a field is placed once and appears in both.
The generator adds a Character tab and an Images tab that creates both images;
the editor's Images tab regenerates the base, keeps the old ones as variants,
and refreshes the avatar only when asked.

Regenerating changes what differs from `appearance.baseSnapshot` and holds
everything else, per `CFG.appearance.body.baseHolds`. Face edits take part:
`appearanceDiffKeys` reports them as `face.hair`, `face.structure` and so on,
because a restyle contradicts the hair hold and a new jaw contradicts the
identity hold, while makeup contradicts nothing.

- `index.html` — the whole app: React + Babel compiled at runtime from the
  `#app-source` script by `bootApp()`, which loads the config first because
  the app source reads it at its top level. PIN-gated behind a decoy page.
- `site-config.js` — shared defaults + merge/load/save helpers. Loaded by
  `index.html` and `settings.html` as a plain script, so keep it
  framework-free.
- `settings.html` — the config editor. Same PIN. Desktop tables collapse to
  stacked cards below 760px.
- `data-proxy.ts` / `image-proxy.ts` / `upload-image.ts` — Supabase edge
  functions. Deploying is manual; check the live version before assuming the
  repo file is what is running (it has been behind before).

## Prompt changes

`personalitySliderPreview` and `buildPersonalityAddendum` are table-driven off
`CFG.traitTiers`. Preview text and prompt text share a tier on purpose, so a
slider's label can never say something different from what it tells the model.
When you change how they assemble a prompt, diff the output against the
previous implementation across randomised slider states rather than eyeballing
it — that is how the last refactor was verified.
