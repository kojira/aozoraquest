import futabaWorried from '@/assets/futaba/bluesky-worried.webp';
import futabaSmile from '@/assets/futaba/bluesky-smile.webp';
import type { DialogueLine } from '@/lib/dialogue';

/** ギルド受付・導入で使うふたばの会話イラスト (通常の笑顔)。 */
export const ONBOARDING_PORTRAIT = { src: futabaSmile, name: 'Blueskyちゃん' };

/** ふたばの救護導入。管理画像は通常会話、ここだけ合意済み表情を指定する。 */
export const ONBOARDING_LINES: readonly DialogueLine[] = [
  { speaker: 'Blueskyちゃん', text: '……きこえる？ だいじょうぶ？', portrait: { src: futabaWorried, name: 'Blueskyちゃん' } },
  { speaker: 'Blueskyちゃん', text: 'けがしてる……。まって、やくそうが あるから。', portrait: { src: futabaWorried, name: 'Blueskyちゃん' } },
  { text: '少女は やくそうを とりだし、そっと きずの 手当てを してくれた。' },
  { speaker: 'Blueskyちゃん', text: 'よかった……！ 気が ついたんだね。' },
  { speaker: 'Blueskyちゃん', text: '村の まえで たおれてたから、しんぱいしたよ。' },
  { speaker: 'Blueskyちゃん', text: 'わたしは Bluesky。この村の 冒険者ギルドで 受付を してるの。' },
];
export const GUILD_INVITATION: DialogueLine = { speaker: 'Blueskyちゃん', text: '村の ギルドで すこし やすんでいかない？ いどの きたひがしの 建物だよ。ゆっくり おいで。' };
export const OPENING_GUIDE_LINES: readonly DialogueLine[] = [
  { text: '【操作ガイド】マップを おしたまま 指を うごかすと 移動。上に ある村へ すすもう。' },
  { text: '【操作ガイド】じぶんを タップすると コマンド。村の人に 向かって 歩くと 話せます。' },
];

/** 導入に続けて Blueskyちゃんが やくそう と そらのはね を手渡す (#703)。リセット (実 +20 付与)
 *  経由のときだけ祝福のセリフを足す。 */
export function starterHandoffLines(blessed: boolean): DialogueLine[] {
  return [
    { speaker: 'Blueskyちゃん', text: 'これも もっていて。また いたくなったら つかってね。' },
    { text: 'やくそうを うけとった！' },
    { speaker: 'Blueskyちゃん', text: 'そらのはねも あげるね。いったことの ある街へ もどれるの。' },
    { text: 'そらのはねを うけとった！ コマンドの「どうぐ」から つかえます。' },
    GUILD_INVITATION,
    ...(blessed ? [{ text: '【はじまりの祝福】あおぞらパワーが 20 ふえた！' }] : []),
    ...OPENING_GUIDE_LINES,
  ];
}
