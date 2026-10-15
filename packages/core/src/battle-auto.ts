/**
 * 自動戦闘 (模擬戦 / バランス sim の 1 手選択)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { SKILLS } from './skills.js';
import { skillMpCostOf } from './battle-job-skills.js';
import { type Command, type BattleState } from './battle-state.js';
import { resolveTurn } from './battle-turn.js';

/** 模擬戦の自動プレイ方針 (現実的な「上手い操作」の代表)。1 ターン分のコマンドを返す。
 *  ため予告 → (見切り職は特技/それ以外は防御) / HP<45% かつ薬草 → 薬草 /
 *  MP 不足かつしずく → しずく / MP 足りれば特技 / それ以外 たたかう。
 *  scripts/sim-battle-balance.ts と /spirit 模擬戦シミュレータで共有する。 */
/**
 * 自動戦闘の 1 手 (**とくぎの選択込み**)。バランス sim (`runAutoBattle` / debug-battle-sim) が使う。
 *
 * **なぜ選択が要るか (#521)**: 以前は `Command` だけを返しており、`resolveTurn` の
 * `skillIndex` は既定の 0 が使われていた = **常に最初のとくぎしか撃たなかった**。
 * とくぎを 1〜2 種しか持たない物理職では問題にならないが、5 種持つ賢者のような職では
 * 「たまたま [0] が弱い技だと壊滅的に見える」。実際これで「キャスターは tier2 以降で
 * 成立しない」という**誤った結論**を出しかけた (技を選べば魔法使い 0% → 99%)。
 *
 * 選び方は **1 手先読み**: 撃てる各とくぎについて同じ turnSeed で `resolveTurn` を回し、
 * 結果が最も良いものを選ぶ。`resolveTurn` は純関数なので試行に副作用は無く、同じ seed を
 * 使うので比較は公平。ヒューリスティック (「威力の高い技」等) だと回復・状態異常・属性相性を
 * 評価できず、キットの設計意図を測れないため採らない。
 */
export function autoBattleAction(s: BattleState, turnSeed?: number): { command: Command; skillIndex: number } {
  const p = s.player;
  const skillCost = skillMpCostOf(p); // 発明家 (匠) の割引を実消費と揃える (sim 判断が過小評価しないよう)
  const none = (command: Command) => ({ command, skillIndex: 0 });
  // ため予告には「防御」が正解 (resolveTurn の設計意図)。ただし **実際に持っている**とくぎに
  // parry 技があるならそれで受ける (防御 + 反撃で上位互換)。**署名スキル (playerSkill) で
  // 判定してはいけない** — #456 のキット化以降、署名と保有とくぎ (playerSkills) は別物で、
  // 戦士は「署名が parry」なのにキットに parry 技を 1 つも持たない。署名で判定していた頃は
  // 戦士が「ため予告に殴りかかる」(被ダメ +49%) 上に、全とくぎが sim で一度も撃たれなかった。
  const parryIdx = s.playerSkills.findIndex((k) => SKILLS[k.kind]?.parry);

  // **その場で倒せる手があるなら、決め打ちより優先する** (#538)。
  //
  // やくそう (HP<45%) と ため予告への防御は「上手い操作」の近似として置いているが、
  // **同ターンに勝てる手があっても無条件で割り込む**ため、全ターンの 7.4% で確定勝利を
  // 捨てていた (実測: やくそうを選んだ 303 ターンのうち 201 = 66%、防御 459 のうち 228 = 50%)。
  // しかも取りこぼしは「決め手のある職」= キャスターに偏って効き、#521 で直した誤診バイアスと
  // **同じ方向**に勝率を下げていた (賢者 70→82% / 予言者 78→89% と、直すとキャスターだけ伸びる)。
  //
  // **この決着ショートカットは「呼び出し元が同じ `turnSeed` でそのターンを解決する」場合にのみ
  // 健全**。先読みと本番で seed が食い違うと、外れた予測のぶんだけ防御を捨てて ためた一撃を
  // まともに食らう。docs/21 §5 のサーバー権威は**毎ターン新鮮な CSPRNG を注入する**ので、
  // その経路から呼ぶなら必ず同じ seed を渡すこと (debug-battle-sim.tsx の duelAuto が実例)。
  const cands = candidateActions(s, turnSeed, skillCost);
  // 勝ち手があるなら決め打ちより前に出る。**選ぶのは bestOf に任せる** — scoreOf は勝ちに
  // +1e6 を与えるので bestOf 自体が勝ち手を優先し、勝ち手が複数あるときはより有利な方
  // (残 HP が多い等) を選べる。`find` の先頭優先だと選択規則が 2 本に分かれる。
  if (cands.some((c) => c.after.outcome === 'win')) return bestOf(cands, s);

  if (s.monster.charging) return parryIdx >= 0 && p.mp >= skillCost ? { command: 'skill', skillIndex: parryIdx } : none('guard');
  if (s.herbs > 0 && p.hp < p.maxHp * 0.45) return none('herb');
  if (s.tonics > 0 && p.mp < skillCost && p.maxMp >= skillCost * 2) return none('tonic');
  if (p.mp < skillCost) return none('attack');
  return bestOf(cands, s);
}

/**
 * 攻撃手 (通常攻撃 + 撃てるとくぎ) を 1 手先読みして、それぞれの結果を返す (#538)。
 *
 * 決着判定と最良手の選択で**同じ試行結果を使い回す**ため、`resolveTurn` の呼び出しは
 * 1 ターンにつき **最大** (1 + とくぎ数) 回に収まる。
 *
 * **通常攻撃も候補に入れる**のが要点。とくぎが常に通常攻撃より強いとは限らない — 遊び人は
 * Lv10 で `サボる` しか持たず、撃ち続けると tier2 の勝率が 0% だが、通常攻撃だけなら 97% 勝てる。
 * 「MP があればとくぎ」と決め打つと、こういう職を「詰んでいる」と誤判定する (#521)。
 *
 * マルチ戦 (群れ) では `resolveTurn` が 1v1 専用で `enemies` に触れないため試行が無意味。
 * 空を返して呼び出し側を従来の決め打ちに落とす。**`>= 1` でなく `> 1` で見る**のは、
 * 将来 1v1 でも `enemies: [monster]` を持たせたときに「1v1 なのに先読みだけ飛ばす」
 * 静かな退行を避けるため。
 */
function candidateActions(
  s: BattleState,
  turnSeed: number | undefined,
  skillCost: number,
): Array<{ action: { command: Command; skillIndex: number }; after: BattleState }> {
  if ((s.enemies?.length ?? 0) > 1) return [];
  const out: Array<{ action: { command: Command; skillIndex: number }; after: BattleState }> = [
    { action: { command: 'attack', skillIndex: 0 }, after: resolveTurn(s, 'attack', turnSeed) },
  ];
  if (s.player.mp >= skillCost) {
    for (let i = 0; i < s.playerSkills.length; i++) {
      out.push({ action: { command: 'skill', skillIndex: i }, after: resolveTurn(s, 'skill', turnSeed, i) });
    }
  }
  return out;
}

/** 先読み済みの候補から最良を選ぶ。同点なら先頭 (通常攻撃) が勝つ = MP を温存する。 */
function bestOf(
  cands: Array<{ action: { command: Command; skillIndex: number }; after: BattleState }>,
  before: BattleState,
): { command: Command; skillIndex: number } {
  if (cands.length === 0) return { command: 'skill', skillIndex: 0 }; // 群れ: 従来どおり
  let best = cands[0]!;
  let bestScore = scoreOf(before, best.after);
  for (const c of cands.slice(1)) {
    const sc = scoreOf(before, c.after);
    if (sc > bestScore) { bestScore = sc; best = c; }
  }
  return best.action;
}

/**
 * 1 ターン後の良さ。与ダメージ + 自分の回復 − 被ダメージ。決着は最優先/最劣先。
 *
 * **限界**: 1 ターンで damage/heal に現れない効果 — 毒・デバフ・自己バフ — は**評価できない**。
 * 眠りのように「敵の行動が消える → 被ダメが減る」形なら同ターンに現れるので拾えるが、
 * `九字切り` / `加護` / `毒の予言` / `破滅の予言` のような遅効性のとくぎは sim では
 * 一度も選ばれない。**これらのとくぎの設計が妥当かは sim では測れない**ので、
 * 職バランスを見るときはこの盲点を踏まえること (N 手先読み化は将来課題)。
 *
 * `bestOf` は通常攻撃を先頭に置き比較が strict `>` なので、**同点なら通常攻撃が勝つ
 * = MP を温存する**。`>=` に変えるとこの性質が壊れるので注意。
 */
function scoreOf(before: BattleState, after: BattleState): number {
  return (
    (after.outcome === 'win' ? 1e6 : 0) -
    (after.outcome === 'lose' ? 1e6 : 0) +
    (before.monster.hp - after.monster.hp) +
    (after.player.hp - before.player.hp)
  );
}

/** 自動プレイで決着まで進める (最大 maxTurns)。turnSeed は渡さず state 由来で決定的。 */
export function runAutoBattle(state: BattleState, maxTurns = 80): BattleState {
  let s = state;
  for (let i = 0; i < maxTurns && s.outcome === 'ongoing'; i++) {
    const a = autoBattleAction(s); // とくぎ選択込み (#521)
    s = resolveTurn(s, a.command, undefined, a.skillIndex);
  }
  return s;
}
