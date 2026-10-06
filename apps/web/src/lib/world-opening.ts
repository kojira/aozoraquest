import futabaWorried from '@/assets/futaba/bluesky-worried.webp';
import futabaSmile from '@/assets/futaba/bluesky-smile.webp';
import type { DialogueLine } from '@/lib/dialogue';

/** ギルド受付・導入で使うふたばの会話イラスト (通常の笑顔)。 */
export const ONBOARDING_PORTRAIT = { src: futabaSmile, name: 'Blueskyちゃん' };

const STRANGER = '？？？';

/** 転移前の虚空 (D-STORY-007)。地図はマウント時から黒で覆い、逆光シルエットの「？？？」がギフトを授ける。
 *  正体は伏せる (会話イラストを出さない)。救護 1 行目の白い閃光で地図へ戻る。 */
export const PROLOGUE_LINES: readonly DialogueLine[] = [
  { text: '……ここは、どこ？', effects: [{ kind: 'fade', to: 'black' }, { kind: 'silhouette', show: true }] },
  { speaker: STRANGER, text: 'やっと とどいた。きみの ことばが。' },
  { speaker: STRANGER, text: 'むこうの 空は いま、いろを うしなっている。七羽の 鳥が、ねむってしまったから。' },
  { speaker: STRANGER, text: 'ぼくには もう、とぶ ちからが のこっていない。' },
  { speaker: STRANGER, text: 'だから、きみに ギフトを わたす。きみの ことばの かたちが、そのまま きみの ちからに なる。' },
  { text: '【ギフト】ことばの ちから を さずかった！' },
  { speaker: STRANGER, text: 'むこうで、きっと……いや、なんでもない。' },
  { speaker: STRANGER, text: '――空を、たのんだよ。' },
  { speaker: STRANGER, text: '……あいつに、みつかる まえに。' },
];

/** ふたばの救護導入。管理画像は通常会話、ここだけ合意済み表情を指定する。
 *  窓全体の portrait は渡さない (？？？行に Blueskyちゃんの絵が出ないよう、話者行ごとに指定)。 */
export const ONBOARDING_LINES: readonly DialogueLine[] = [
  { speaker: 'Blueskyちゃん', text: '……きこえる？ だいじょうぶ？', portrait: { src: futabaWorried, name: 'Blueskyちゃん' },
    effects: [{ kind: 'fade', to: 'clear' }, { kind: 'silhouette', show: false }, { kind: 'flash', color: 'white' }] },
  { speaker: 'Blueskyちゃん', text: 'けがしてる……。まって、やくそうが あるから。', portrait: { src: futabaWorried, name: 'Blueskyちゃん' } },
  { text: '少女は やくそうを とりだし、そっと きずの 手当てを してくれた。' },
  { speaker: 'Blueskyちゃん', text: 'よかった……！ 気が ついたんだね。', portrait: ONBOARDING_PORTRAIT },
  { speaker: 'Blueskyちゃん', text: '村の まえで たおれてたから、しんぱいしたよ。', portrait: ONBOARDING_PORTRAIT },
  { speaker: 'Blueskyちゃん', text: 'わたしは Bluesky。この村の 冒険者ギルドで 受付を してるの。', portrait: ONBOARDING_PORTRAIT },
];
export const GUILD_INVITATION: DialogueLine = { speaker: 'Blueskyちゃん', text: '村の ギルドで すこし やすんでいかない？ いどの きたひがしの 建物だよ。ゆっくり おいで。', portrait: ONBOARDING_PORTRAIT };
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
    ...(blessed ? [{ text: '【ギフト】ことばの ちから で あおぞらパワーが 20 ふえた！' }] : []),
    ...OPENING_GUIDE_LINES,
  ];
}
