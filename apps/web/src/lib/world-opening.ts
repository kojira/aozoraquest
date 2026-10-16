import { sceneLines } from '@aozoraquest/core';
import type { DialogueLine } from '@/lib/dialogue';
import { WELCOME_POWER } from '@/lib/onboarding-reset';
import { sceneDialogue } from '@/lib/scene-dialogue';

/** 操作の説明なので UI としてコードに残す (D-DIALOGUE-006 J2。操作が変わるときに一緒に変わる)。 */
export const OPENING_GUIDE_LINES: readonly DialogueLine[] = [
  { text: '【操作ガイド】マップを押したまま指を動かすと移動。上にある村へ進もう。' },
  { text: '【操作ガイド】自分をタップするとコマンド。村の人に向かって歩くと話せます。' },
];

/** 冒頭 (？？？のプロローグ → 救護) を始められるか。どちらかの場面が無ければ始めない (印も立てない)。 */
export function openingAvailable(): boolean {
  return sceneLines('opening.prologue').length > 0 && sceneLines('opening.rescue').length > 0;
}

/** 手渡しの窓を出せるか。場面が無ければ出さない (道具は今までどおり渡る)。 */
export function handoffAvailable(): boolean {
  return sceneLines('opening.handoff').length > 0;
}

/** 冒頭の窓の行。手渡しが続くときはギルドへの誘いとガイドを手渡しの後へ回す。 */
export function openingLines(withHandoff: boolean): DialogueLine[] {
  if (!openingAvailable()) return [];
  const lines = [...sceneDialogue('opening.prologue'), ...sceneDialogue('opening.rescue')];
  return withHandoff ? lines : [...lines, ...sceneDialogue('opening.invitation'), ...OPENING_GUIDE_LINES];
}

/** 導入に続けて Blueskyちゃんが やくそう と そらのはね を手渡す (#703)。順番は 手渡し → 誘い → 祝福 → 操作ガイド。
 *  祝福はリセット (実 +20 付与) 経由のときだけ。 */
export function starterHandoffLines(blessed: boolean): DialogueLine[] {
  if (!handoffAvailable()) return [];
  return [
    ...sceneDialogue('opening.handoff'),
    ...sceneDialogue('opening.invitation'),
    ...(blessed ? sceneDialogue('opening.blessing', { vars: { power: WELCOME_POWER } }) : []),
    ...OPENING_GUIDE_LINES,
  ];
}
