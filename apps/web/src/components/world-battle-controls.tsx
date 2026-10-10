import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import type { BattleState, Command } from '@aozoraquest/core';
import { MONSTERS_BY_ID, isPureHealSkill, skillMpCostOf } from '@aozoraquest/core';
import { MonsterSvg } from './monster-svg';
import { HpBar, TypedLines } from './battle-view';
import { OVERLAY_Z } from './world-hud';
import { battleMessageLines } from '@/lib/battle-message-lines';

/**
 * あおぞらワールドの戦闘 UI (DQ 風の配置)。
 *  - フィールドに敵スプライト (名前・数は右ペイン、体力は見抜ける職業のみ)。
 *  - input: 下段左右 2 ペイン (左=コマンド 2 列 / 右=敵リスト or どうぐの中身)。
 *  - message/result: コマンドを消して全幅メッセージ窓 (タップ送り)。message は 1 タップ 1 行
 *    (DQ1〜3 風に 4 行窓へ積み、古い行は上へ流す)。画面のどこをタップしても送れる (#757)。
 * **下段は常に同じ固定高さ (4 行)** にして、フェーズが変わってもフィールドの敵の
 * 位置がずれない / メッセージ枠が伸縮しない (認知負荷を下げる)。
 * DQ の作法どおりメッセージ枠は 4 行分。
 */
export type BattlePhase = 'message' | 'input' | 'result';

/** message/result の戦闘オーバーレイの z。会話の送り面 (900) と同じ層で footer (10) や PC の
 *  左レール (30) より上。中の全画面送り面 (zIndex:-1) はこの層の背景より上・窓より下になる。
 *  input は従来の OVERLAY_Z のまま (コマンド操作の層を変えない)。上枠 HUD はこの +1 に置く。 */
export function battleOverlayZ(phase: BattlePhase): number {
  return phase === 'input' ? OVERLAY_Z : 900;
}
/** message の窓に積む最大行数 (DQ 風 4 行窓)。 */
const WINDOW_LINES = 4;

/** 下段 (コマンド窓 / メッセージ窓) の固定高さ = メッセージ 4 行 + 余白。全フェーズ共通。
 *  コマンド 2 列 3 行のタップ target を確保するため少し高めに (実機の誤タップ対策)。 */
const BOTTOM_H = '7.8em';
const WINDOW: React.CSSProperties = {
  border: '2px solid rgba(255,255,255,0.55)',
  borderRadius: 4,
  background: 'rgba(16,18,26,0.85)',
};
const TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9)';

export function WorldBattleControls({
  state,
  phase,
  busy,
  showEnemyVitals,
  resultLines,
  onCommand,
  onAdvance,
  prevState,
  onReveal,
}: {
  state: BattleState;
  phase: BattlePhase;
  /** 支払い等の処理中はメッセージ送りを止める (二重確定防止) */
  busy: boolean;
  showEnemyVitals: boolean;
  /** result フェーズで出す報酬行 (経験値・素材など)。message/input では未使用。 */
  resultLines: readonly string[];
  onCommand: (c: Command, skillIndex?: number) => void;
  onAdvance: () => void;
  /** 直前ターンの state。message の最後の行までは敵の体力をこちらで見せる (#757)。 */
  prevState?: BattleState | undefined;
  /** message の最後の行に着いた (= 最終 HP と揺れを出す) ことを turn 付きで知らせる。 */
  onReveal?: (turn: number) => void;
}) {
  const [itemMenu, setItemMenu] = useState(false);
  // 入力フェーズを離れたら (メッセージ送り/リザルト) どうぐを閉じておく。
  // 描画上は input のときだけ出るが、state が開きっぱなしだと次の入力で一瞬開いて見えうる (レビュー ★★)。
  useEffect(() => {
    if (phase !== 'input') setItemMenu(false);
  }, [phase]);
  const skillCost = skillMpCostOf(state.player); // 発明家 (匠) の MP 割引を反映
  const lowMp = state.player.mp < skillCost;
  // デプロイ跨ぎの旧 sealed state は playerSkills が無いことがある → 署名スキル 1 個にフォールバック。
  const skills = state.playerSkills ?? [state.playerSkill];
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  const messageLines =
    phase === 'result'
      ? resultLines
      : state.turn === 0
        ? [`${state.monster.name}が あらわれた！ ${monsterDef?.intro ?? ''}`]
        : battleMessageLines(state.lastEvents.map((e) => e.text));
  // message は 1 タップ 1 行。段 (phase+turn) が変わったら先頭から (古い段の index は捨てる)。
  const stepKey = `${phase}-${state.turn}`;
  const [step, setStep] = useState({ key: stepKey, index: 0 });
  const lineIndex = phase === 'message' && step.key === stepKey ? step.index : 0;
  const lastLine = phase !== 'message' || lineIndex >= messageLines.length - 1;
  // 表示中の行を打ち終えたか。空行だけなら最初から送れる (TypedLines の onDone が来ず詰むため)。
  const typingKey = `${stepKey}:${lineIndex}`;
  const [typedKey, setTypedKey] = useState<string | null>(null);
  const typed = typedKey === typingKey || !messageLines.join('').trim();
  const skipRef = useRef<(() => void) | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  useEffect(() => {
    if (lastLine) onRevealRef.current?.(state.turn);
  }, [lastLine, state.turn]);
  /** 送り (窓・全画面送り面の共通): タイプ中→全文 / 次の行あり→1 行出す / 最後→onAdvance。 */
  const advance = () => {
    if (busy) return; // 処理中は送らない
    if (!typed) skipRef.current?.();
    else if (!lastLine) setStep({ key: stepKey, index: lineIndex + 1 });
    else onAdvance();
  };
  // 最後の行までは前ターンの敵 HP を見せ、揺れも最後の行で出す (開幕 turn 0 は前が無い)。
  const fieldState = !lastLine && prevState ? prevState : state;
  return (
    <>
      {/* 全画面の送り面 (会話の送り面と同じ作法)。fixed なので地図・黒い領域・footer まで覆う。
          zIndex:-1 で、この戦闘オーバーレイ (battleOverlayZ) の背景より上・窓より下に入る。
          input では出さない = コマンドは従来どおり押せる。 */}
      {phase !== 'input' && (
        <div data-battle-advance aria-hidden onClick={advance} style={{ position: 'fixed', inset: 0, zIndex: -1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }} />
      )}
      {/* フィールド: 敵スプライト (+ 見抜ける職業のみ体力)。下段が固定高さなので
          ここ (flex:1) の高さも一定 = 敵の位置がフェーズで動かない。 */}
      {/* 表示専用。message/result ではタップを背面の送り面へ通す。 */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', pointerEvents: phase === 'input' ? 'auto' : 'none' }}>
        <BattleFieldEnemy state={state} hpState={fieldState} revealed={lastLine} showEnemyVitals={showEnemyVitals} defeated={phase === 'result' && state.outcome === 'win'} />
      </div>

      {/* 下段: 常に BOTTOM_H の固定高さ */}
      <div style={{ flex: `0 0 ${BOTTOM_H}`, height: BOTTOM_H }}>
        {phase === 'input' ? (
          // **`gridTemplateRows` を明示する。** 省くと暗黙行が max-content になり、右の
          // とくぎ一覧が伸びたぶんだけグリッド全体が BOTTOM_H を突き抜ける。はみ出しは
          // 戦闘オーバーレイの overflow:hidden に切られて**左の「にげる」「どうぐ」が
          // 描画も当たり判定も消える** = HP が減っても逃げも回復もできない詰み
          // (職 Lv10 でとくぎ 5 個から発生。レビュー ★★★ 2026-07-27)。
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'minmax(0, 1fr)', gap: '0.4em', height: '100%' }}>
            {/* 左: 基本コマンド。**「とくぎ」は置かない** — とくぎは右にいつも出ているので、
                1 タップ挟むだけ無駄だった。空いたぶん 1 行を大きく使える。 */}
            <div style={{ ...WINDOW, height: '100%', padding: '0.2em 0.3em', display: 'grid', gridTemplateRows: 'repeat(4, 1fr)', rowGap: '0.1em' }}>
              <DqRow label="たたかう" onClick={() => onCommand('attack')} disabled={busy || itemMenu} />
              <DqRow label="ぼうぎょ" onClick={() => onCommand('guard')} disabled={busy || itemMenu} />
              {/* どうぐ: 再タップで閉じる (DQ の戻る慣習)。開くと右がとくぎ→どうぐに変わる。 */}
              <DqRow label="どうぐ" onClick={() => setItemMenu((v) => !v)} disabled={busy || (state.herbs <= 0 && state.tonics <= 0)} cursor={itemMenu} />
              {/* 逃げられないストーリー戦 (canFlee: false) では出さない (D-STORY-009。サーバーも受け付けない)。 */}
              {state.story?.canFlee !== false && <DqRow label="にげる" onClick={() => onCommand('flee')} disabled={busy || itemMenu} />}
            </div>
            {/* 右: **既定でとくぎ一覧**。どうぐを開いている間だけ道具に入れ替わる。 */}
            {/* とくぎが増えるほど縦に伸びるので**この枠自体をスクロールさせる**。
                minHeight:0 が無いと flex/grid の自動最小サイズで枠が伸び、overflow が
                効かないまま外へあふれる (上の gridTemplateRows と対で必要)。 */}
            <div style={{ ...WINDOW, height: '100%', minHeight: 0, overflowY: 'auto', padding: '0.2em 0.4em', display: 'flex', flexDirection: 'column', rowGap: '0.1em' }}>
              {itemMenu ? (
                <>
                  <DqRow fill={false} label={`やくそう ×${state.herbs}`} onClick={() => { setItemMenu(false); onCommand('herb'); }} disabled={busy || state.herbs <= 0 || state.player.hp >= state.player.maxHp} />
                  <DqRow fill={false} label={`そらのしずく ×${state.tonics}`} onClick={() => { setItemMenu(false); onCommand('tonic'); }} disabled={busy || state.tonics <= 0 || state.player.mp >= state.player.maxMp} />
                  <DqRow fill={false} label="もどる" onClick={() => setItemMenu(false)} disabled={busy} />
                </>
              ) : (
                // **MP コストは行に出さない。** skillMpCostOf は全とくぎ共通の単一値なので
                // 全行に同じ「(MP4)」が並ぶだけで情報が増えず、320px 幅では 6〜7 文字の
                // 技名を 2 行に折り返させて行高を 1.67 倍にしていた (レビュー実測)。
                // MP は HUD にあり、足りなければ行が無効化されるので伝わる。
                skills.map((sk, i) => (
                  <DqRow
                    key={`${sk.name}-${i}`}
                    fill={false}
                    label={sk.name}
                    onClick={() => onCommand('skill', i)}
                    // 純回復技は満タンなら無意味 → 無効化 (キット技も効果ベースで判定)
                    disabled={busy || lowMp || (isPureHealSkill(sk.kind) && state.player.hp >= state.player.maxHp)}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          // message / result: 全幅メッセージ窓 (固定 4 行高さ = 下段と同じ)
          <DqMessageWindow
            lines={phase === 'message' ? messageLines.slice(Math.max(0, lineIndex + 1 - WINDOW_LINES), lineIndex + 1) : messageLines}
            typingKey={typingKey}
            onTyped={() => setTypedKey(typingKey)}
            skipRef={skipRef}
            onAdvance={advance}
          />
        )}
      </div>
    </>
  );
}

/** 敵スプライト + 見抜ける職業のみ体力 (名前・数は右ペインなのでここには出さない)。 */
function BattleFieldEnemy({ state, hpState, revealed, showEnemyVitals, defeated }: {
  state: BattleState;
  /** 体力表示に使う state (message の最後の行までは前ターン)。 */
  hpState: BattleState;
  /** 最後の行に着いたか。揺れはここで出す。 */
  revealed: boolean;
  showEnemyVitals: boolean;
  defeated: boolean;
}) {
  const monsterDef = MONSTERS_BY_ID[state.monsterId];
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        key={state.turn}
        style={{ display: 'inline-block', opacity: defeated ? 0.35 : 1, transform: defeated ? 'rotate(180deg)' : 'none', transition: 'opacity 300ms ease' }}
        className={!defeated && revealed && state.lastEvents.some((e) => e.actor === 'player' && e.damage) ? 'trial-hit' : ''}
      >
        <MonsterSvg species={monsterDef?.species ?? ''} tint={monsterDef?.tint} size={84} monsterId={state.monsterId} />
      </div>
      {/* **名前はどの職でも出す。** 以前は右ペインに出していたが、そこをとくぎ一覧にしたので
          消えてしまい、体力を見抜ける 5 職 (sage/seer/miko/mage/ninja) 以外の 11 職では
          「あらわれた!」を送った後に敵の名前を確認する手段が無くなっていた。絵は species と
          tint の色違いが多く (いわのゴーレム / こけむしゴーレム 等)、絵だけでは判別できない。
          体力を見抜ける職は下の HpBar が名前も出すので、そちらに任せて二重に出さない。 */}
      {!showEnemyVitals && !defeated && (
        <div style={{ fontSize: '0.85em', color: '#fff', textShadow: TEXT_SHADOW, marginTop: '0.2em' }}>
          {state.monster.name}
        </div>
      )}
      {showEnemyVitals && !defeated && (
        <>
          <HpBar name={state.monster.name} hp={hpState.monster.hp} maxHp={state.monster.maxHp} labelColor="#fff" />
          {/* ため/回復を使う敵は生の MP を「バー」で見せる (「あと何回」の答えは出さず、
              残量から尽きるタイミングを予想させる)。通常攻撃だけの敵は MP を使わないので
              出さない (混乱防止)。数値は出してよい (maxMp は遭遇ごとに分散 + 発動は確率
              なので、見えても厳密な予想はできない)。
              fill 色だけ脅威種別で出し分ける (回復=緑/ため=橙。色は"答え"でなく"何を警戒
              するか"の手がかり — レビュー ★★)。 */}
          {monsterDef?.ability && state.monster.maxMp > 0 && (
            <div style={{ maxWidth: 340, margin: '0.1em auto 0', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68em', color: 'rgba(255,255,255,0.85)', textShadow: TEXT_SHADOW }}>
                <span>MP</span>
                <span style={{ fontFamily: 'ui-monospace, monospace' }}>{state.monster.mp} / {state.monster.maxMp}</span>
              </div>
              <div style={{ height: 5, background: 'var(--color-track-bg)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(state.monster.mp / state.monster.maxMp) * 100}%`, height: '100%', background: monsterDef.ability === 'healer' ? '#5fc37e' : '#e8802e', transition: 'width 300ms ease' }} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * DQ 風コマンド窓の 1 行 (styles.css の .dq-command)。
 *
 * 左のコマンド窓は `gridTemplateRows: repeat(4, 1fr)` で行を等分するので `minHeight: 0` に
 * して行をセル高さに合わせる。**右のとくぎ一覧はスクロールさせたいので逆**に、
 * `.dq-command { min-height: 2.4em }` (= 自分で決めたタップ下限) を残したまま
 * `flexShrink: 0` で縮まないようにする。両方とも縮めると、枠に収まっているように
 * 見えて 1 行 0.7em まで潰れ、押せない行が並ぶ (レビュー実測 ★★★)。
 */
function DqRow({ label, onClick, disabled, cursor = false, fill = true }: { label: string; onClick: () => void; disabled: boolean; cursor?: boolean; fill?: boolean }) {
  return (
    <button
      type="button"
      className="dq-command"
      onClick={onClick}
      disabled={disabled}
      style={fill ? { width: '100%', minHeight: 0 } : { width: '100%', flexShrink: 0 }}
    >
      {cursor ? `▸ ${label}` : label}
    </button>
  );
}

/** 全幅メッセージ窓 (固定 4 行高さ)。打ち終えた行はそのまま、最後の行だけをタイプする。
 *  送りの判断は親の advance (窓のタップも全画面送り面と同じ処理)。 */
function DqMessageWindow({ lines, typingKey, onTyped, skipRef, onAdvance }: {
  lines: readonly string[];
  /** 最後の行の識別子。変わったら打ち直す (同じ文が続いても 1 行ずつ止める)。 */
  typingKey: string;
  onTyped: () => void;
  skipRef: MutableRefObject<(() => void) | null>;
  onAdvance: () => void;
}) {
  // message は最後の 1 行だけを打つ。result (報酬行) は従来どおり全行をまとめて打つ。
  const typingAll = !typingKey.startsWith('message-');
  const before = typingAll ? [] : lines.slice(0, -1);
  const typing = typingAll ? lines : lines.slice(-1);
  return (
    <div
      className="dq-message"
      onClick={onAdvance}
      style={{
        ...WINDOW,
        height: '100%',
        overflowY: 'auto',
        padding: '0.4em 0.7em',
        fontSize: '0.9em',
        lineHeight: 1.6,
        color: '#fff',
        textShadow: TEXT_SHADOW,
        cursor: 'pointer',
      }}
    >
      {before.map((l, i) => (
        <div key={i}><span aria-hidden>{l}</span></div>
      ))}
      <TypedLines key={typingKey} lines={typing} onDone={onTyped} skipRef={skipRef} />
    </div>
  );
}
