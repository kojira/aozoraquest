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
  { speaker: STRANGER, text: 'やっと届いた。きみの言葉が。' },
  { speaker: STRANGER, text: 'むこうの空は今、色を失っている。七羽の鳥が、眠ってしまったから。' },
  { speaker: STRANGER, text: 'ぼくにはもう、飛ぶ力が残っていない。' },
  { speaker: STRANGER, text: 'だから、きみにギフトを渡す。きみの言葉の形が、そのままきみの力になる。' },
  { text: '【ギフト】ことばの ちからを授かった！' },
  { speaker: STRANGER, text: 'むこうで、きっと……いや、なんでもない。' },
  { speaker: STRANGER, text: '――空を、たのんだよ。' },
  { speaker: STRANGER, text: '……あいつに、見つかる前に。' },
];

/** ふたばの救護導入。管理画像は通常会話、ここだけ合意済み表情を指定する。
 *  窓全体の portrait は渡さない (？？？行に Blueskyちゃんの絵が出ないよう、話者行ごとに指定)。 */
export const ONBOARDING_LINES: readonly DialogueLine[] = [
  { speaker: 'Blueskyちゃん', text: '……聞こえる？　大丈夫？', portrait: { src: futabaWorried, name: 'Blueskyちゃん' },
    effects: [{ kind: 'fade', to: 'clear' }, { kind: 'silhouette', show: false }, { kind: 'flash', color: 'white' }] },
  { speaker: 'Blueskyちゃん', text: 'けがしてる……。待って、やくそうがあるから。', portrait: { src: futabaWorried, name: 'Blueskyちゃん' } },
  { text: '少女はやくそうを取り出し、そっと傷の手当てをしてくれた。' },
  { speaker: 'Blueskyちゃん', text: 'よかった……！　気がついたんだね。', portrait: ONBOARDING_PORTRAIT },
  { speaker: 'Blueskyちゃん', text: '村の前で倒れてたから、心配したよ。', portrait: ONBOARDING_PORTRAIT },
  { speaker: 'Blueskyちゃん', text: 'わたしはBluesky。この村の冒険者ギルドで受付をしてるの。', portrait: ONBOARDING_PORTRAIT },
];
export const GUILD_INVITATION: DialogueLine = { speaker: 'Blueskyちゃん', text: '村のギルドで少し休んでいかない？　井戸の北東の建物だよ。ゆっくりおいで。', portrait: ONBOARDING_PORTRAIT };
export const OPENING_GUIDE_LINES: readonly DialogueLine[] = [
  { text: '【操作ガイド】マップを押したまま指を動かすと移動。上にある村へ進もう。' },
  { text: '【操作ガイド】自分をタップするとコマンド。村の人に向かって歩くと話せます。' },
];

/** 導入に続けて Blueskyちゃんが やくそう と そらのはね を手渡す (#703)。リセット (実 +20 付与)
 *  経由のときだけ祝福のセリフを足す。 */
export function starterHandoffLines(blessed: boolean): DialogueLine[] {
  return [
    { speaker: 'Blueskyちゃん', text: 'これも持っていて。また痛くなったら使ってね。' },
    { text: 'やくそうを受け取った！' },
    { speaker: 'Blueskyちゃん', text: 'そらのはねもあげるね。行ったことのある街へ戻れるの。' },
    { text: 'そらのはねを受け取った！　コマンドの「どうぐ」から使えます。' },
    GUILD_INVITATION,
    ...(blessed ? [{ text: '【ギフト】ことばの ちからであおぞらパワーが20増えた！' }] : []),
    ...OPENING_GUIDE_LINES,
  ];
}
