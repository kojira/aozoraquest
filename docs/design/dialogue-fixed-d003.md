# D-DIALOGUE-003 — fixed map dialogue

Issue #710. Base dev d715d556. Owner approved 「やってみて」 for map-inner **96% × 35%** border box and guild smile. Screenshots IMG_6890/6891 show variable body height and shifted/shrunken portrait.

## Approved implementation contract

Map conversation stays centered with constant bottom gap; typing, long/short speech, narration, missing portrait, speaker changes and four guild choices cannot change body x/y/width/height. Speaker plate sits immediately above the body in a reserved single-line area. Portrait uses the remaining map area, stable geometry and `contain`; no face/hat cropping. Readable fonts remain; overflow scrolls inside the frame, final choice reachable by touch/mouse/keyboard, scroll gesture never advances dialogue. Viewport dialogs retain existing layout. No new layout framework.

Production seam: `DialogueWindow` in `World`'s relative map-inner parent. Replace content-driven map flex sizes with fixed map-relative positioning. Preserve `NpcPortrait`, authored source priority, explicit rescue worried→smile, choices pending guard and quest/reward authority. Only map scrolling gets gesture protection/focus and per-line scroll reset; no state/schema/API changes, migration or new fallback.

## One-to-one completion checklist

| Contract | RED assertion | Minimal GREEN / evidence | Review |
|---|---|---|---|
| 96% × 35%, centered, constant gap | actual World map vs frame bboxes at 320/390/1280, speech/menu/narration/instruction | fixed border box; screenshots + numeric JSON | pending independent review |
| stable plate/portrait, image containment | bboxes equal across lines/choices, `contain`, loaded authorized images | separate reserved area; worried/smile screenshots | pending |
| internal overflow, input operable | last choice reachable; pointer scroll cannot advance, keyboard focus scroll | internal scrolling, map-only gesture guard | pending |
| viewport untouched | existing component tests plus viewport browser case | keep non-map styles/input path | pending |
| authority/data preserved | existing opening integration pending/selected-ID/reward assertions | unchanged quest/edge/source-priority code | pending |
| guild smile | read-only shared NPC snapshot + original hash/size | propose only futaba-bluesky.portraitImage; no write | parent release gate |

Artifacts live outside repo under `~/.pi/dialogue-d003-evidence/`. RED logs are failure proof, not success proof. Independent review follows through parent; no merge/deploy/PDS writes here. Local browser emulation is not iPhone acceptance.

## Portrait data gate

Shared dev/prod `app.aozoraquest.world.npcs` record: replace only `futaba-bluesky.portraitImage` via existing admin CLI/blob API using approved original `EC0FCB73-9A47-4DB7-957A-8E1F3C08AC93-512x768.webp` (77696 bytes), preserve every other field/NPC and current CAS. `npc-image --dry-run` **uploads a blob**, so it must NOT run in this pass. No hard-coded override of administrator images. Exact read-only proposal and evidence recorded after verification; execution requires separate approval.

## Verification proof (implementation)

- RED before production edit: `~/.pi/dialogue-d003-evidence/red.log`; actual World screenshots/JSON in `red/`. Frame heights speech→guild menu were 85.375→137.0625px (320/390), 85.375→94.328125px (PC), failing the approved ratio and equality assertions. A plate assertion initially compared reduced vs full objects; corrected before GREEN. Ratio/frame failures independently reproduced the reported bug.
- GREEN: `green.log`, opening-story production World + isolated real edge handlers passed, including pending shield, selected quest ID, exact rewards and authored portrait priority. At 320/390/1280, inner maps 306/376/546px have frame 293.75×107.09375 / 360.953125×131.59375 / 524.15625×191.09375px. All captured speech/menu/narration/instruction states have identical x/y/width/height, and plate/portrait geometry stays fixed.
- `focused.log`: 4 browser tests passed. Typing, long text, no portrait, changed name, touch scroll, mouse drag (including ending on choice), keyboard End/Tab/Enter and last-choice touch tap checked. Viewport remains content-sized/footer-anchored. Initial viewport test synchronization/rounding assertions corrected; no production change needed.
- Local required checks: web typecheck, build and all 450 unit tests pass; lint has 0 errors / 25 existing warnings. Focused screenshots use real authorized bundled images. Build has existing chunk-size warnings.
- Actual World comparison images manually inspected: `comparison-320.png`, `comparison-390.png`, `comparison-1280.png` (before/after rows; short speech, four-choice guild menu, instruction columns). At 320 the last two choices require internal scroll; test verifies reachability. These are Chromium local isolated screenshots, not live shared-data or physical-iPhone acceptance.
- Scope reviewed by implementer: only map layout/input and browser tests; no edge/quest/state/reward/admin source selection code changed. Independent reviewer and CI results are recorded on PR by parent/review gate; no release authority implied.

## Exact portrait proposal (not executed)

Read-only GET observed shared NPC record CID `bafyreidwvi2knc7pxpbgttnsttegl6xfeqhwn3irun3bavivl5myvhjwea`.
Only `npcs[id=futaba-bluesky].portraitImage` changes:
- from WebP 512×768, 82630 bytes, blob `bafkreiggoeve4m273n6umssqskhmof5k3ttaob3qlo46b7h2qk7h4x5dka`
- to WebP 512×768, 77696 bytes, expected raw blob CID `bafkreidpne4355kaornzbipxgoca6uz7kubqj6tzpajb5nxdizlgetce5m`
- original SHA256 `6f6939bef540745b90a1f733840f533f550304fa7978121eb6e34656624c44eb`, byte-identical to bundled smile used in screenshots.

External `portrait-proposal.json` + `npcs-proposed-value.json` preserve the snapshot; structural comparison verified exactly one changed field. They are NOT a stale record to blindly write. After explicit shared dev/prod data approval, use the existing `node scripts/admin-data.mjs npc-image futaba-bluesky portrait <approved-original.webp>` command, which freshly GETs, uploads, changes only that field and CAS-writes. Verify no intervening authored portrait change first. Snapshot includes rollback source; rollback also requires fresh CID and preservation of current unrelated fields. No blob upload, dry-run PUT, PDS record write, merge or deployment occurred in this pass.
