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
      "村の そとの そらいろスライムを 3たい たおしてくれんか。",
      "すんだら わしに はなしかけておくれ。たびじたくの おれいを わたそう。"
    ],
    "progress": [
      "そらいろスライムを 3たいじゃ。むりせず 村の ちかくで な。",
      "じぶんを おして メニューを ひらくと、あと どれだけか わかるぞ。"
    ],
    "done": [
      "ありがとう。これで 村の みんなも あんしんじゃ。",
      "おれいの パワーと しずくで、なんでも屋の『ぬののふく』を つくれるぞ。",
      "つくったら『そうび』で みにつけておくれ。やどやの おかみも こまっておったな。"
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
      "やくそうを 3つ わけてくれないかい。",
      "3つ そろったら わたしに はなしかけてね。うけとったら おれいを するよ。"
    ],
    "progress": [
      "やくそうは『どうぐ』で たしかめられるよ。つかったぶんは また あつめてね。"
    ],
    "done": [
      "たすかったよ。やくそうを 3つ うけとったよ。",
      "ひとつは あなたの たびに もっていきな。つかれたら やどやへ おいで。",
      "つぎは なんでも屋の むすめに はなしかけてみてね。"
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
      "コウモリの翼膜を 2つ あつめて わたしてくれない？",
      "村の そとの コウモリが おとすよ。そろったら わたしの ところへ もどってね。"
    ],
    "progress": [
      "翼膜は『もちもの』で かくにんできるよ。2つ そろったら もってきてね。"
    ],
    "done": [
      "ありがとう！ これで たびじたくが すすむよ。",
      "パワーと しずくは あなたの そうびづくりに つかってね。",
      "じゅんびが できたら、おじいさんに つぎの街の はなしを きいてみて。"
    ]
  }
];
}
