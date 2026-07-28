/**
 * **同梱のモンスター一覧 (フォールバック)。本番の正は管理者 PDS のレコード** (#419 / #537)。
 *
 * ここに書いた敵はリポジトリが公開なので誰でも読める。**新しい敵・調整済みの値を
 * ここへ書かない** — エディタ (/admin/monsters) で編集して保存すれば、レコードが
 * この一覧を丸ごと差し替える (`setMonsterOverrides`)。
 *
 * この一覧が残っている理由は 2 つ:
 *  1. レコードが読めないときのフォールバック (戦闘を止めない)
 *  2. テスト・sim の決定的な土台
 * レコード運用が安定したら、中身を汎用のプレースホルダへ縮める (#537 の最終段)。
 */
import type { MonsterDef } from './battle.js';

export const MONSTERS: readonly MonsterDef[] = [

  // tier1: 手習い (初心者でも勝てる)。**HP を明示して弱い敵は本当に弱く**した (以前は hpBase=66 が
  // 支配的で全 tier1 が HP~70 横並び → 序盤が重い真因)。XP は xp を省いて
  // baselineXp (基準 HP + atk/agi) で自動算出 = 敵の強さと XP が構造的に連動する (スライム 2・
  // ヒカリダケ 8 程度)。個別に効かせたい敵だけ xp を明示する。
  // そらいろスライム: 最弱の練習敵 (低 HP・低 XP・低ドロップ)。序盤の的。
  { id: 'sky-slime', element: 'water', name: 'そらいろスライム', species: 'slime', level: 1, tier: 1, xp: 3, stats: [7, 7, 8, 6, 10], hp: 5, drops: [{ item: 'slime-drop', chance: 0.3 }, { item: 'herb', chance: 0.35 }], intro: 'ぷるぷると跳ねている。' },
  // 色違い強い版 (tint で塗り替え)。base より少し硬く XP/素材も上。専用素材 red-jelly。
  { id: 'red-slime', element: 'fire', name: 'あかいスライム', species: 'slime', tint: '#e0574a', spawnWeight: 0.4, level: 2, tier: 1, xp: 5, stats: [13, 12, 10, 8, 12], hp: 8, drops: [{ item: 'red-jelly', chance: 0.5 }, { item: 'herb', chance: 0.08 }], intro: '赤くぬめって 脈打っている。' },
  { id: 'cave-bat', element: 'wind', name: 'ほらあなコウモリ', species: 'bat', level: 3, tier: 1, xp: 8, stats: [12, 8, 26, 6, 12], hp: 11, drops: [{ item: 'bat-wing', chance: 0.6 }, { item: 'herb', chance: 0.3 }, { item: 'sky-feather', chance: 0.12 }], intro: 'ばさばさと羽音を立てている。' },
  { id: 'dusk-bat', element: 'wind', name: 'よるのコウモリ', species: 'bat', tint: '#5b6bd0', spawnWeight: 0.4, level: 4, tier: 2, xp: 12, stats: [14, 9, 28, 7, 13], hp: 10, drops: [{ item: 'dusk-wing', chance: 0.5 }, { item: 'sky-feather', chance: 0.12 }], intro: '夜色の翼で 音もなく舞う。' },
  { id: 'glow-shroom', element: 'earth', name: 'ヒカリダケ', species: 'mushroom', level: 5, tier: 2, xp: 15, stats: [8, 20, 4, 18, 12], hp: 14, drops: [{ item: 'mush-spore', chance: 0.6 }, { item: 'herb', chance: 0.4 }, { item: 'sky-dew', chance: 0.25 }], intro: 'ほんのり光って動かない…?' },
  { id: 'crimson-shroom', element: 'earth', name: 'べにヒカリダケ', species: 'mushroom', tint: '#c23a5b', spawnWeight: 0.4, level: 6, tier: 2, xp: 18, stats: [9, 22, 4, 20, 12], hp: 12, drops: [{ item: 'crimson-spore', chance: 0.5 }, { item: 'sky-dew', chance: 0.2 }], intro: '毒々しい紅に 明滅している。' },
  // はぐれメタル型 (DQ のメタルスライム): レア出現・高 XP (100)・毎ターン逃走。
  //   - **`flatDef: 255`**: DQ2 のメタルスライム/はぐれメタルと同値。tier 倍率を通さない実効 def
  //     なので、どのレベルの相手にも identity が成立する (最高の Lv50 将軍でも atk 108 <
  //     255×defCoef/atkCoef = 127 なので通常攻撃は **0**)。`stats[1]` は flatDef に上書きされる
  //     ので実効値には効かない (プロファイルの見た目を他 tier1 と揃えてある)。
  //   - **通常攻撃も魔法も 0**: minDamage=0 なので守備を上回れなければ 1 も通らない。魔法は
  //     def 無視で通るため `resistAllMagic` で別途 0 にする (
  //     「攻撃力が低くても必ず 1 通る」は仕様の読み違いだった)。
  //   - **高 agi (38)**: 回避 (最大 dodgeMax) が張り付き「避けられる」。
  //   - **低 HP (hp6 → monsterMaxHp で実質 8)**: 仕留める道は**会心の一撃のみ** (プレイヤーの
  //     会心は def 無視 #432 → フルダメージで一撃)。通常/魔撃では削り切る前に逃げる。
  //     専用ロジックは使わず守備/agi/HP の数値だけで「メタル」を表現する方針は不変
  //     (専用ロジック禁止 2026-07-20)。特殊武器での貫通は #519。
  { id: 'stray-slime', resistAllMagic: true, flatDef: 255, name: 'はぐれスライム', species: 'metal-slime', level: 4, tier: 2, stats: [8, 24, 38, 6, 34], hp: 6, mp: 0, xp: 100, spawnWeight: 0.06, drops: [{ item: 'metal-shard', chance: 0.5 }], ability: 'fleer', intro: 'きらりと 金属の光を放っている。' },
  // ── tier1 追加 (#536)。DQ3 序盤 (スライム4 / おおがらす6 / いっかくうさぎ8) の XP 帯に合わせる。
  //    species は既存 10 種のみ使う (MonsterSvg が species ごとに絵を持つ)。色違いは tint で作る。
  { id: 'grass-slime', element: 'earth', name: 'くさいろスライム', species: 'slime', tint: '#6fbf5a', level: 1, tier: 1, xp: 4, stats: [8, 8, 7, 6, 10], hp: 9, drops: [{ item: 'slime-drop', chance: 0.35 }, { item: 'herb', chance: 0.4 }], intro: '草にまぎれて ぷるぷるしている。' },
  { id: 'dawn-bat', element: 'wind', name: 'あさやけコウモリ', species: 'bat', tint: '#e8a06a', level: 2, tier: 1, xp: 6, stats: [11, 8, 22, 6, 12], hp: 11, drops: [{ item: 'bat-wing', chance: 0.5 }, { item: 'herb', chance: 0.3 }], intro: '朝日を嫌って飛びまわる。' },
  { id: 'pale-shroom', element: 'earth', name: 'しろヒカリダケ', species: 'mushroom', tint: '#d8d2c0', level: 3, tier: 1, xp: 9, stats: [9, 16, 4, 14, 12], hp: 14, drops: [{ item: 'mush-spore', chance: 0.55 }, { item: 'herb', chance: 0.35 }], intro: '白くぼんやり光っている。' },
  // ── tier2 追加。DQ3 の おおありくい(12) 相当まで。
  { id: 'moss-slime', element: 'earth', name: 'こけスライム', species: 'slime', tint: '#4a7c3f', level: 5, tier: 2, stats: [16, 18, 9, 8, 12], hp: 17, xp: 14, drops: [{ item: 'slime-drop', chance: 0.4 }, { item: 'mush-spore', chance: 0.3 }], intro: 'こけをまとって じっとしている。' },
  { id: 'gale-raven', element: 'wind', name: 'かぜきりガラス', species: 'raven', tint: '#7a8fb0', level: 6, tier: 2, stats: [20, 10, 30, 10, 14], hp: 21, xp: 19, drops: [{ item: 'raven-feather', chance: 0.4 }, { item: 'sky-feather', chance: 0.25 }], intro: '風を切って急降下してくる。' },
  // ── tier3 追加。DQ3 中盤 (キャタピラー/ぐんたいガニ = 35) の帯。
  { id: 'stone-golem', element: 'earth', name: 'いわのゴーレム', species: 'golem', tint: '#9b8f80', level: 8, tier: 3, stats: [32, 30, 8, 10, 8], hp: 26, xp: 28, drops: [{ item: 'golem-core', chance: 0.45 }, { item: 'metal-shard', chance: 0.25 }], intro: 'ごろりと岩が起き上がった。' },
  { id: 'marsh-serpent', element: 'water', name: 'ぬまの大蛇', species: 'serpent', tint: '#5f8f6a', level: 10, tier: 3, stats: [34, 14, 20, 10, 10], hp: 30, xp: 42, drops: [{ item: 'serpent-scale', chance: 0.45 }, { item: 'sky-dew', chance: 0.2 }], intro: '沼底から ぬるりと現れた。' },
  // tier2: 修練。xp 34〜52 (healer は削り合いが長引くぶん高め)
  { id: 'moss-golem', element: 'earth', name: 'こけむしゴーレム', species: 'golem', tint: '#6f9b5e', level: 9, tier: 3, stats: [38, 36, 6, 10, 8], hp: 28, xp: 34, drops: [{ item: 'golem-core', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '地響きを立てて起き上がった。', skillName: 'いわなだれ', ability: 'charger' },
  // 鬼火は tier2 の caster (#536)。**魔法は回避判定を通らない** (doAttack の `if (!opts.useInt)`) ので、
  // 回避特化 (忍者) が一方的に無傷で勝ち続けるのを止める役。int 34 は tier2 最高で、
  // 「鬼火が魔法を撃つ」のは回復役より自然。入口 (tier1) には置かず、**tier2 から**回避が
  // 通用しなくなる = 先へ進むほど別の備えが要る、という学びの山にする。
  { id: 'will-o-wisp', element: 'fire', name: 'あおい鬼火', species: 'wisp', level: 6, tier: 2, stats: [18, 12, 24, 34, 12], hp: 24, xp: 21, drops: [{ item: 'wisp-ember', chance: 0.5 }, { item: 'sky-dew', chance: 0.35 }], intro: 'ゆらゆらとこちらを見ている。', ability: 'caster', spell: { name: 'あおい炎', element: 'fire', min: 3, max: 7, intScale: 0.12 } },
  { id: 'river-serpent', element: 'water', name: 'かわながれ大蛇', species: 'serpent', level: 13, tier: 4, stats: [42, 18, 22, 10, 10], hp: 22, xp: 60, drops: [{ item: 'serpent-scale', chance: 0.5 }, { item: 'herb', chance: 0.2 }], intro: '水面から鎌首をもたげた。', skillName: 'まきつき' },
  // tier3: 真剣勝負。xp 62〜96
  { id: 'night-raven', element: 'wind', name: 'よるのおおガラス', species: 'raven', level: 20, tier: 5, stats: [48, 14, 34, 16, 14], hp: 24, xp: 62, drops: [{ item: 'raven-feather', chance: 0.45 }, { item: 'sky-dew', chance: 0.3 }, { item: 'sky-feather', chance: 0.25 }], intro: '月を背に静かに舞い降りた。', ability: 'caster', spell: { name: 'かまいたち', element: 'wind', min: 4, max: 8, intScale: 0.1 } },
  { id: 'blue-oni', element: 'water', name: 'あおおに', species: 'oni', level: 21, tier: 5, stats: [66, 28, 12, 8, 12], hp: 30, xp: 78, drops: [{ item: 'oni-horn', chance: 0.45 }], intro: '金棒を担いで笑っている。', skillName: 'かなぼうふりまわし', ability: 'charger' },
  { id: 'sky-dragon', element: 'void', name: 'そらのりゅう', species: 'dragon', level: 27, tier: 6, stats: [58, 24, 18, 26, 10], hp: 30, xp: 96, drops: [{ item: 'dragon-fang', chance: 0.4 }], intro: '雲を裂いて姿を現した!', ability: 'healer', healName: 'りゅうの いこい' },
];
