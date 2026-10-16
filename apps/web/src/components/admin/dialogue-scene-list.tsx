import type { DialogueScene, NpcDef } from '@aozoraquest/core';
import { DialogueWindow } from '@/components/dialogue-window';
import { hereName, sceneDialogueLine } from '@/lib/scene-dialogue';

/** 場面の表示名 (D-DIALOGUE-006 §2 の一覧)。 */
const LABELS: Record<string, string> = {
  'opening.prologue': 'プロローグ', 'opening.rescue': '救護', 'opening.invitation': '誘い', 'opening.handoff': '手渡し',
  'opening.blessing': '祝福 (リセット後だけ)', 'guild.first': '初回', 'guild.return': '2回目以降',
  'inn.ask': '値段を聞く', 'inn.thanks': '泊まった後', 'inn.decline': '断った後', 'shop.tutorial': '初めての説明',
};
/** 場面ごとに使える差し込み (core の検証と同じ)。 */
const VARS: Record<string, string> = { 'opening.blessing': '{power}', 'inn.ask': '{price}' };

export function sceneLabel(id: string, npcs: readonly NpcDef[]): string {
  const [base, npcId] = id.split(':');
  const label = LABELS[base!] ?? id;
  return npcId ? `${label}: ${npcs.find((n) => n.id === npcId)?.name ?? npcId}の上書き` : label;
}
export const sceneVars = (id: string): string => VARS[id] ?? 'なし';

export const SCENE_GROUPS: readonly { title: string; match: (id: string) => boolean }[] = [
  { title: '冒頭', match: (id) => id.startsWith('opening.') },
  { title: 'ギルド', match: (id) => id.startsWith('guild.') },
  { title: '宿屋', match: (id) => id.startsWith('inn.') },
  { title: 'なんでも屋', match: (id) => id.startsWith('shop.') },
];

/** プレビュー。ゲームと同じ DialogueWindow で、表情タグを外して出す。差し込みは見本の値、その場の人は「その場の人」。 */
export function DialogueScenePreview({ scene, npcs, onDone }: { scene: DialogueScene; npcs: readonly NpcDef[]; onDone: () => void }) {
  const lines = scene.lines.filter((l) => l.text.trim() !== '').map((l) =>
    sceneDialogueLine({ ...l, text: l.text.replace('{price}', '10').replace('{power}', '20') }, hereName('その場の人'), npcs));
  if (lines.length === 0) return null;
  return <DialogueWindow lines={lines} onDone={onDone} />;
}
