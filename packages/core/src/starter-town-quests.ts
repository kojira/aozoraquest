import type { GameQuestDef } from './quest-data.js';

/** 同梱の導入依頼。明示的に管理画面で保存するまで有効にはしない。 */
export function starterTownQuests(): GameQuestDef[] {
  return [
  {
    "id": "futaba-slimes",
    "title": "スライムから 村をまもろう",
    "npcId": "futaba-elder",
    "objective": {
      "kind": "defeat",
      "monsterId": "sky-slime",
      "count": 3
    },
    "reward": {
      "power": 4,
      "itemId": "slime-drop",
      "count": 1
    },
    "intro": [
      "むかし、空は七羽の鳥に守られておった。鳥たちが眠ると、空は色を失う。七羽すべてを目覚めさせたとき、空に虹の橋がかかる……",
      "まずは村を助けて旅の力をつけておくれ。村の外のそらいろスライムを3体倒してくれんか。",
      "済んだらわしに話しかけておくれ。旅支度のお礼を渡そう。"
    ],
    "progress": [
      "そらいろスライムを3体じゃ。無理せず村の近くでな。",
      "自分を押してメニューを開くと、あとどれだけかわかるぞ。"
    ],
    "done": [
      "ありがとう。これで村のみんなも安心じゃ。",
      "お礼のパワーとしずくで、なんでも屋の『ぬののふく』を作れるぞ。",
      "作ったら『そうび』で身につけておくれ。やどやの おかみも困っておったな。"
    ]
  },
  {
    "id": "futaba-herbs",
    "title": "やどやの やくそう",
    "npcId": "futaba-innkeeper-wife",
    "objective": {
      "kind": "collect",
      "itemId": "herb",
      "count": 3
    },
    "reward": {
      "power": 3,
      "itemId": "herb",
      "count": 1
    },
    "requireFlags": [
      "futaba_slimes_done"
    ],
    "intro": [
      "むらおさの頼みを聞いてくれたんだってね。次はやくそうを3つ分けてくれないかい。",
      "3つそろったらわたしに話しかけてね。受け取ったらお礼をするよ。"
    ],
    "progress": [
      "やくそうは『どうぐ』で確かめられるよ。使ったぶんはまた集めてね。"
    ],
    "done": [
      "助かったよ。やくそうを3つ受け取ったよ。",
      "ひとつはあなたの旅に持っていきな。疲れたら宿屋へおいで。",
      "次はなんでも屋の むすめに話しかけてみてね。"
    ]
  },
  {
    "id": "futaba-wings",
    "title": "たびじたくの おてつだい",
    "npcId": "futaba-shopfront",
    "objective": {
      "kind": "collect",
      "itemId": "bat-wing",
      "count": 2
    },
    "reward": {
      "power": 4,
      "itemId": "slime-drop",
      "count": 1
    },
    "requireFlags": [
      "futaba_herbs_done"
    ],
    "intro": [
      "旅に出るなら、旅支度を手伝わせて。かわりにコウモリの翼膜を2つ集めて渡してくれない？",
      "村の外のコウモリが落とすよ。そろったらわたしのところへ戻ってね。"
    ],
    "progress": [
      "翼膜は『もちもの』で確認できるよ。2つそろったら持ってきてね。"
    ],
    "done": [
      "ありがとう！　これで旅支度が進むよ。",
      "パワーとしずくはあなたの装備づくりに使ってね。",
      "これで旅の力は十分。井戸のそばのギルドのBlueskyちゃんがあなたを探してたよ。"
    ]
  },
  {
    id: 'futaba-tool-care',
    title: '道具の手入れに',
    npcId: 'futaba-bluesky',
    objective: { kind: 'collect', itemId: 'slime-drop', count: 2 },
    reward: { itemId: 'herb', count: 2, power: 5 },
    intro: [
      '依頼主は村の道具屋。道具の手入れに、スライムのしずくを2こ届けてほしいんだって。',
      'そろったらギルドで報告してね。今持っているものも渡せるよ。',
      '報告するとスライムのしずくを2こ渡します。報酬はやくそう2こと、あおぞらパワー5。一人一度の依頼です。',
    ],
    progress: ['スライムのしずくを2こそろえて、ギルドで報告してね。'],
    done: ['スライムのしずくを2こ受け取ったよ。村の道具屋へ届けておくね。ありがとう！'],
  }
];
}
