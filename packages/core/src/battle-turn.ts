/**
 * 1v1 のターン解決 (resolveTurn)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { SKILLS, runSkillMulti } from './skills.js';
import { type CombatSides } from './combat-target.js';
import { STATUS_REGISTRY, applyBeforeAct, tickStatuses } from './statuses.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng, turnRng } from './battle-rng.js';
import { type JobSkill, skillMpCostOf, mpTraitFires } from './battle-job-skills.js';
import { MONSTERS_BY_ID } from './battle-monsters.js';
import { type Command, type TurnEvent, type BattleState } from './battle-state.js';
import { doAttack, doMagic } from './battle-attack.js';
import { monsterCommand } from './battle-monster-ai.js';

function playerSkillAction(state: BattleState, skill: JobSkill, rng: () => number, events: TurnEvent[]): void {
  const { player, monster } = state;
  // プラグイン実行 (#452): とくぎは SKILLS[kind] のデータ定義を EFFECT_HANDLERS で解決する。
  // 見切り (parry) 等の「宣言型」とくぎは effects 空で、宣言は resolveTurn 冒頭が担う。
  const def = SKILLS[skill.kind];
  if (!def) return;
  // ソロでも runSkillMulti で**効果ごとに対象解決**する (#453/#456)。ソロ陣営は allies=[player] /
  // enemies=[monster] の退化ケース。これにより allAllies (=自分) / allEnemies (=敵) を使うパーティ
  // 支援職 (隊長/巫女/吟遊詩人) の全体技がソロでは自己バフ/敵デバフとして機能する。既存の
  // self/oneEnemy 技は [player]/[monster] に解決され**挙動不変**。
  const sides: CombatSides = { allies: [player], enemies: [monster] };
  runSkillMulti(def, player, sides, (defender) => ({
    attacker: player,
    defender,
    rng,
    events,
    skillName: skill.name,
    actorSide: 'player',
    engine: { doAttack, doMagic },
  }), { label: skill.name, events, actor: 'player' });
}

/**
 * 1 ターンを解決する。player のコマンドを受け、素早さ順に両者が行動する。
 * state は**破壊しない** (新しい state を返す)。
 *
 * `turnSeed` を渡すと、そのターンの乱数を seed 由来 (`turnRng`) ではなく**外部供給の seed**で
 * 回す (docs/21-server-authority §5)。サーバー権威戦闘で Worker が毎ターン新鮮なエントロピー
 * (CSPRNG/kuda) を注入し「先読み・引き直し」を封じるための薄い口。省略時は従来どおり
 * `turnRng(seed, turn)` = 完全決定的 (試練/テストは seed 方式のまま不変)。
 */
export function resolveTurn(prev: BattleState, command: Command, turnSeed?: number, skillIndex = 0): BattleState {
  if (prev.outcome !== 'ongoing') return prev;

  // コピー (Combatant は現状 flat なので spread で足りる)。
  // 注意: 将来 Combatant に配列/オブジェクト (装備等) を足すときは deep copy に変えること
  // (shallow spread のままだとイミュータブル性が壊れる)。
  const state: BattleState = {
    ...prev,
    turn: prev.turn + 1,
    // statuses は tick で破壊的に更新するため deep copy (passives は不変なので参照共有で可)。
    // 旧 sealed state で statuses 未定義なら省略 (exactOptional 準拠・エンジンは undefined を no-op 扱い)。
    player: {
      ...prev.player,
      guarding: false,
      ...(prev.player.statuses ? { statuses: prev.player.statuses.map((s) => ({ ...s })) } : {}),
    },
    monster: {
      ...prev.monster,
      guarding: false,
      ...(prev.monster.statuses ? { statuses: prev.monster.statuses.map((s) => ({ ...s })) } : {}),
    },
    lastEvents: [],
  };
  // command==='skill' のとき使う特技 (#436: 毎ターン選択)。範囲外/未設定 (デプロイ跨ぎの旧 sealed
  // state で playerSkills が無い) は署名スキル playerSkill に安全側フォールバック。
  const skills = state.playerSkills ?? [state.playerSkill];
  const selectedSkill = skills[skillIndex] ?? skills[0] ?? state.playerSkill;
  const events: TurnEvent[] = [];
  // 外部供給 seed があればそれで (サーバー権威: 先読み不可)、無ければ seed 由来 (決定的)。
  const rng = turnSeed === undefined ? turnRng(state.seed, state.turn) : createRng(turnSeed >>> 0);
  const mCommand = monsterCommand(state.monster, state, rng);

  // ── コマンドの実効化 ──
  // MP 不足の特技 / 在庫切れのやくそうは「たたかう」にフォールバック
  // (UI は disabled にする前提。エンジン側の防御的措置で、ターンを無駄にしない)。
  const t = BATTLE_TUNING;
  let cmd: Command = command;
  const skillCost = skillMpCostOf(state.player); // 発明家/巫女の MP 割引を反映
  if (command === 'skill' && state.player.mp < skillCost) {
    events.push({ actor: 'player', text: `MP が足りない! (${state.player.mp}/${skillCost})` });
    cmd = 'attack';
  } else if (command === 'herb' && state.herbs <= 0) {
    events.push({ actor: 'player', text: 'やくそうを持っていない!' });
    cmd = 'attack';
  } else if (command === 'tonic' && state.tonics <= 0) {
    events.push({ actor: 'player', text: 'そらのしずくを持っていない!' });
    cmd = 'attack';
  }
  if (cmd === 'skill') {
    state.player.mp -= skillCost;
  }

  // ── にげる: 成功したら即離脱 (敵は行動しない)。失敗はターンを失い敵の行動を受ける。 ──
  if (cmd === 'flee') {
    const chance = Math.min(
      t.fleeMax,
      Math.max(t.fleeMin, t.fleeBase + (state.player.agi - state.monster.agi) * t.fleeAgiScale),
    );
    if (rng() < chance) {
      state.outcome = 'fled';
      events.push({ actor: 'player', text: `${state.player.name}はうまく逃げ切った!` });
      state.lastEvents = events;
      return state;
    }
    events.push({ actor: 'player', text: 'にげられない! 回り込まれてしまった!' });
    // このターンは敵だけが行動する (下の act で player 分岐は cmd==='flee' により no-op)
  }

  // 防御系 (ぼうぎょ / 見切り) は行動順に関係なく先に立てる
  // (先手を取られても防御・反撃が意味を持つように。見切り持ちは鈍足ジョブが多い)。
  if (cmd === 'guard') {
    state.player.guarding = true;
    // 翌ターンまで相手の動きを読める (回避ボーナス)。このターン(1) + 次ターン(1) = 2。
    state.player.focus = 2;
    if (state.mpGuardGain > 0 && mpTraitFires(state.mpTraitChance, rng)) {
      state.player.mp = Math.min(state.player.maxMp, state.player.mp + state.mpGuardGain);
      events.push({
        actor: 'player',
        text: `${state.player.name}はぼうぎょして息を整えた。(${state.mpTraitName ? `${state.mpTraitName}: ` : ''}MP +${state.mpGuardGain})`,
      });
    } else {
      events.push({ actor: 'player', text: `${state.player.name}はぼうぎょのかまえ!` });
    }
  }
  if (cmd === 'skill' && SKILLS[selectedSkill.kind]?.parry) {
    state.player.parrying = true;
    events.push({ actor: 'player', text: `${state.player.name}は${selectedSkill.name}の構え! (防御しつつ反撃)` });
  }
  // ため中は防御宣言しない (このターンは必ず解放する。宣言すると「身を固めた直後に
  // ため攻撃」という矛盾イベント + 幻の防御半減が発生する)。
  if (mCommand === 'guard' && !state.monster.charging) {
    state.monster.guarding = true;
    events.push({ actor: 'monster', text: `${state.monster.name}は身を固めている。` });
  }

  // 素早さ + 乱数で行動順
  const playerFirst = state.player.agi + rng() * 20 >= state.monster.agi + rng() * 20;

  const act = (who: 'player' | 'monster') => {
    if (state.outcome !== 'ongoing') return; // 敵が逃げる等で決着済みなら以降の行動をスキップ
    if (state.player.hp === 0 || state.monster.hp === 0) return;
    const self = who === 'player' ? state.player : state.monster;
    // 行動不能 (眠り/麻痺/転倒/束縛)。none なら false = 従来どおり行動。
    if (applyBeforeAct(self, { rng, events, actor: who })) return;
    // 行動前に存在した clearOnAct 状態 (前ターンからのかくれみ/九字切り) を記録。行動で「消費」し
    // 末尾で除去する。この行動中に付与した自己バフ (かくれみ/九字切りを張る等) は消さない。
    const consumedOnAct = (self.statuses ?? []).filter((s) => STATUS_REGISTRY[s.id]?.clearOnAct);
    if (who === 'player') {
      if (cmd === 'attack') {
        doAttack(state.player, state.monster, rng, events, 'player');
        if (state.mpAttackGain > 0 && mpTraitFires(state.mpTraitChance, rng)) {
          state.player.mp = Math.min(state.player.maxMp, state.player.mp + state.mpAttackGain);
        }
      } else if (cmd === 'skill') {
        playerSkillAction(state, selectedSkill, rng, events);
      } else if (cmd === 'herb') {
        const heal = Math.round(state.player.maxHp * t.herbHealRatio);
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + heal);
        state.herbs -= 1;
        state.herbsUsed += 1;
        events.push({ actor: 'player', text: `${state.player.name}はやくそうを使った! HP が ${heal} 回復。(残り ${state.herbs})` });
      } else if (cmd === 'tonic') {
        const gain = Math.round(state.player.maxMp * t.tonicMpRatio);
        state.player.mp = Math.min(state.player.maxMp, state.player.mp + gain);
        state.tonics -= 1;
        state.tonicsUsed += 1;
        events.push({ actor: 'player', text: `${state.player.name}はそらのしずくを飲んだ! MP が ${gain} 回復。(残り ${state.tonics})` });
      }
      // guard は宣言済み / flee 失敗はこのターン行動なし
    } else {
      // ため中なら宣言どおり解放 (mCommand は無視)。予告 → 解放の 2 ターン制で、
      // プレイヤーが予告を見て防御する読み合いを作る。
      if (state.monster.charging) {
        state.monster.charging = false;
        const skillName = MONSTERS_BY_ID[state.monsterId]?.skillName ?? 'つよいこうげき';
        doAttack(state.monster, state.player, rng, events, 'monster', {
          power: BATTLE_TUNING.chargedPower,
          hitBonus: -0.05,
          label: skillName,
        });
      } else if (mCommand === 'charge') {
        // このターンは攻撃せず「ため」を予告する (charger、MP 消費)
        state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterChargeMpCost);
        state.monster.charging = true;
        events.push({ actor: 'monster', text: `${state.monster.name}は力をためている…!` });
      } else if (mCommand === 'heal') {
        // healer の自己回復 (MP 消費)。MP が尽きるまでの読み合いを作る
        state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterHealMpCost);
        // 固定値 (healAmount) が最優先。割合は HP の大きい敵ほど強くなるので原則使わない。
        const mdef = MONSTERS_BY_ID[state.monsterId];
        const healed = mdef?.healAmount
          ?? Math.round(state.monster.maxHp * (mdef?.healRatio ?? BATTLE_TUNING.healerHealRatio));
        const before = state.monster.hp;
        state.monster.hp = Math.min(state.monster.maxHp, state.monster.hp + healed);
        const name = MONSTERS_BY_ID[state.monsterId]?.healName ?? 'きずをいやす';
        events.push({ actor: 'monster', text: `${state.monster.name}は${name}! HP が ${state.monster.hp - before} 回復。` });
      } else if (mCommand === 'flee') {
        // はぐれメタル型: 逃走成功 → 即決着 (報酬なし)。倒せなかった悔しさを残す。
        state.outcome = 'monster-fled';
        events.push({ actor: 'monster', text: `${state.monster.name}は にげだした!` });
      } else if (mCommand === 'cast') {
        // caster の属性魔撃 (MP 消費)。def 無視・int スケール。onLethal を通らないので物理耐性の
        // 覇王/不動 も魔法致死では死ぬ (設計どおりの弱点)。聖騎士の清き心 (魔法反射) はこの doMagic 内で発火する。
        const spell = MONSTERS_BY_ID[state.monsterId]?.spell;
        if (spell) {
          state.monster.mp = Math.max(0, state.monster.mp - BATTLE_TUNING.monsterCastMpCost);
          const span = spell.max - spell.min;
          const amount = spell.min + Math.floor(rng() * (span + 1)) + Math.round(state.monster.int * (spell.intScale ?? 0));
          doMagic(state.monster, state.player, rng, events, 'monster', {
            amount,
            ...(spell.element ? { element: spell.element } : {}),
            label: spell.name,
          });
        } else {
          doAttack(state.monster, state.player, rng, events, 'monster');
        }
      } else if (mCommand === 'attack') {
        doAttack(state.monster, state.player, rng, events, 'monster');
      }
      // guard は宣言済み
    }
    // 行動で消費された状態 (前ターンからのかくれみ/九字切り) のみ除去。この行動で張った
    // 自己バフは残す (かくれみ→次ターンの攻撃で解除、が正しい)。none なら no-op。
    if (consumedOnAct.length && self.statuses) {
      self.statuses = self.statuses.filter((s) => !consumedOnAct.includes(s));
    }
  };

  act(playerFirst ? 'player' : 'monster');
  act(playerFirst ? 'monster' : 'player');

  // ターン終了の状態処理 (毒ダメージ等) → turns 減衰・除去。none なら no-op。
  // 毒で HP0 になった場合は下の勝敗判定 (hp===0) が拾う。両者が同ターンの毒で相討ちになった
  // 場合、勝敗判定は monster.hp===0 を player より先に見るため win を優先する (仕様。決定的)。
  if (state.outcome === 'ongoing') {
    tickStatuses(state.player, { rng, events, actor: 'player' });
    tickStatuses(state.monster, { rng, events, actor: 'monster' });
  }

  // 見切りは 1 ターン限り (発動しなかったら解除)。ぼうぎょの余韻 (focus) は 1 減衰。
  state.player.parrying = false;
  state.monster.parrying = false;
  state.player.focus = Math.max(0, state.player.focus - 1);

  // 勝敗判定 (敵の逃走 = monster-fled で既に決着している場合は上書きしない)
  if (state.outcome !== 'ongoing') { /* monster-fled 等: 確定済み */ }
  else if (state.monster.hp === 0) state.outcome = 'win';
  else if (state.player.hp === 0) state.outcome = 'lose';
  else if (state.turn >= BATTLE_TUNING.maxTurns) {
    // 引き分け規定: 残 HP 割合が高い方の勝ち。同率は draw。
    const pr = state.player.hp / state.player.maxHp;
    const mr = state.monster.hp / state.monster.maxHp;
    state.outcome = pr > mr ? 'win' : pr < mr ? 'lose' : 'draw';
    const closing =
      state.outcome === 'win'
        ? 'ブルスコン「そこまで! 判定勝ちだ、見事だったよ」'
        : state.outcome === 'lose'
          ? 'ブルスコン「そこまで! 今回は相手が上手だったね」'
          : 'ブルスコン「そこまで! 引き分けだ、いい勝負だったよ」';
    events.push({ actor: 'monster', text: closing });
  }

  state.lastEvents = events;
  return state;
}
