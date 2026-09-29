# D-DIALOGUE-005 — NPC line expression tags

Issue #714. Base dev 2dafc36. Owner approved the design (『それでいいよー』). No merge/deploy/PDS writes in this PR.

## Contract

- A NPC line may start with one tag `[name]` (`/^\[([a-z]+)\]/`). The tag is not displayed but stays in the saved record (future TTS). Only the leading tag is parsed; `[a][b]x` shows `[b]x`.
- The line's portrait is `expressionImages[name]` when registered; otherwise the window's normal portrait (`portraitImage`, or the bundled guild smile as before). No tag / unregistered tag → normal. There is no enumerated tag list.
- `NpcDef.expressionImages?: Record<string, NpcImage>`: keys `/^[a-z]+$/`, values follow the `portrait` image rules. A line that is only a tag (empty after stripping) is invalid.
- Opening rescue (`ONBOARDING_LINES`, bundled worried/smile) is unchanged.

## Seams

| Contract | Seam | RED | GREEN |
|---|---|---|---|
| parse/strip, own-key lookup, validation | `packages/core/src/npc-data.ts` (`parseNpcLine`, `npcExpressionImage`, `validateNpcs`) | `npc-expression.test.ts`: 3/4 failed | 4/4 |
| edge serves expression portrait by cid, same checks + immutable cache; bad name/kind 400, unregistered/other cid 404 | `apps/edge/src/npc-image.ts` (`expression` query) | `npc-image.test.ts`: 404 instead of 200 | pass |
| displayed text never has the tag; per-line portrait only for registered tag | `apps/web/src/lib/npc-image.ts` `npcDialogueLines` → `world.tsx` npcTalk (talk, guild 話す, quest lines) and admin preview | `npc-dialogue-lines.test.ts`: not a function | pass |
| line-to-line portrait switch never blanks or refetches | `NpcPortrait` keeps one mounted `<img>` per src, shows previous until next loads | `npc-expression-portrait.spec.ts`: 600 ms `naturalWidth 0` on switch, normal refetched | every frame painted, 1 request per image |
| admin registers expression image; editor shows raw text | `npc-image-upload.tsx` / `admin-npcs.tsx` (pending upload keyed `id/portrait:tag`) | — | `npc-image-upload.spec.ts` saves only `expressionImages.sad` |
| CLI | `scripts/admin-data.mjs npc-image <id> portrait <file> --expression <name>` | — | arg validation checked by hand |

Evidence: `~/.pi/dialogue-d005-evidence/`.

## Data rollout (separate approval; not executed)

See PR description. `npc-image --dry-run` uploads a blob, so it is not run before approval.
