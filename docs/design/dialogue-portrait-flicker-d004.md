# D-DIALOGUE-004 — portrait missing + flicker on guild steps

Issue #712. Base dev d3ffbd80. Scope approved: fixes 1 and 2 only (no onError fallback, no expression/data changes).

## Cause

- `World` keyed `DialogueWindow` by `guild:lines`, so every conversation step (受付→メニュー→話す) remounted it: the backdrop fade restarted from alpha 0 and a new `<img>` was created.
- `/api/npc-image` success responses were `cache-control: no-store`, so each remount refetched/decoded the portrait and it rendered blank meanwhile.

## Contract / checklist

| Contract | Seam | RED | GREEN | Review |
|---|---|---|---|---|
| cid-addressed validated image is cacheable; errors stay `no-store` | `apps/edge/src/npc-image.ts` | `npc-image.test.ts` header assertion failed (`no-store`) | 200 → `public, max-age=31536000, immutable`; 404/502 `no-store` asserted | pending |
| no remount per step; backdrop alpha never < 0.5, portrait element persists decoded | `World` → `DialogueWindow conversationStep` | `guild-dialogue-steps.spec.ts` frame recorder: alpha 0→0.5 and new undecoded img on step change | same backdrop/img across welcome→menu→話す | pending |
| per-step reset of line/typing/choice/done | `DialogueWindow` state `{step, st}`; done/choosing refs scoped by step | — | step change resets; stale interval/select results ignored | pending |
| final advance closes in same event (no lingering done window) | `DialogueWindow.advance` | existing `opening-story.spec.ts` elder report `readAll` detached/timeout | `onDone` fired from the advancing event when the result is done | pending |
| fixed 96%×35% layout, pending shield, selected quest id, onDone identity | unchanged `World` handlers | existing `dialogue-window` / `opening-story` e2e | pass | pending |

Evidence: `~/.pi/dialogue-d004-evidence/fix/` (RED `red-e2e*`, `red-edge-header.txt`; GREEN `green-e2e-final.txt`, `green-edge-header.txt`, `web-vitest-final.txt`). No merge/deploy/PDS writes.
