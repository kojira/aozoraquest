/** JobCard の本文テキスト描画 (能力テキスト・フレーバー・日本語折り返し・タイトル字サイズ)。 */

import type { ManaCost } from '@aozoraquest/core';
import { manaCostTotal } from '@aozoraquest/core';
import { INK, INK_SOFT } from './job-card-layout';
import { ManaCostSvgRow } from './job-card-mana';

/**
 * 能力テキスト: 名前 (bold) + コスト行 (MTG の ":" 前に太字で来る発動コスト) + 説明文。
 *
 * 表示フォーマット (MTG 能力の典型):
 *   <名前>
 *   <コスト>: <説明>
 * ただしコストが「なし」「空」ならパッシブ扱いで "<名前> — <説明>" の 1 行短縮版。
 */
export function EffectBlock(props: {
  x: number; y: number; width: number;
  name: string;
  /** 構造化マナコスト。abilityManaCost === undefined なら旧 cost: string で fallback。
   *  null または total=0 は passive 扱い。 */
  abilityManaCost?: ManaCost | null;
  /** タップを起動コストに含むか。マナとは独立 (タップだけで起動の場合もある)。 */
  abilityTap?: boolean;
  /** 後方互換: interim 文字列コスト。abilityManaCost が無いときに使う。 */
  cost: string;
  description: string;
  /** クリーチャー時のキーワード能力 1 行 (例: "飛行、警戒")。空文字なら非表示。 */
  keywordLine?: string;
}) {
  const { x, y, width, name, abilityManaCost, abilityTap, cost, description, keywordLine } = props;
  const NAME_FONT = 32;
  const DEFAULT_BODY_FONT = 24;
  const DEFAULT_CHARS_PER_LINE = 21;
  const KEYWORD_FONT = 22;
  const LINE_H = 34;
  const TEXT_COLOR = '#000';
  const LABEL_COLOR = '#2a1a08';
  const KEYWORD_COLOR = '#4a3018';
  const keywordOffset = keywordLine ? 38 : 0;

  // 説明文を auto-fit: budget (デフォルト font 24px の行数) のピクセル高に収まるよう
  // 24 → 22 → 20 → 18 px の順にフォントを試す。省略 (…) を発生させない方針。
  function fitDescription(text: string, lineBudget: number): { font: number; lineH: number; lines: string[] } {
    const pxBudget = lineBudget * LINE_H;
    const candidates = [24, 22, 20, 18];
    for (const font of candidates) {
      const lh = Math.round(font * 1.42);
      const cpl = Math.floor(DEFAULT_CHARS_PER_LINE * DEFAULT_BODY_FONT / font);
      const lines = wrapJa(text, cpl, 99);
      if (lines.length * lh <= pxBudget) return { font, lineH: lh, lines };
    }
    // 最小フォントでも超過: 最小フォントの自然行数で返す (極端な長文時の最後の砦)。
    const font = 18;
    const lh = Math.round(font * 1.42);
    const cpl = Math.floor(DEFAULT_CHARS_PER_LINE * DEFAULT_BODY_FONT / font);
    return { font, lineH: lh, lines: wrapJa(text, cpl, 99) };
  }

  // passive 判定: 構造化マナがあれば (total + tap) で判断、無ければ文字列の「なし」を見る。
  // タップだけで起動するケース (例: 「{T}: 〜」) も active 扱い。
  const isPassive = abilityManaCost !== undefined
    ? ((abilityManaCost === null || manaCostTotal(abilityManaCost) === 0) && !abilityTap)
    : (!cost || cost === 'なし' || /^\s*なし\s*$/.test(cost));

  const nameLine = (
    <text x={x} y={y + keywordOffset} fontSize={NAME_FONT} fontWeight="800"
          fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
      {name}
    </text>
  );

  // クリーチャー用キーワード行 (上端)。空文字なら何も出さない。
  const keywordTag = keywordLine ? (
    <text x={x} y={y} fontSize={KEYWORD_FONT} fontWeight="700" fontStyle="italic"
          fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={KEYWORD_COLOR}>
      {keywordLine}
    </text>
  ) : null;

  if (isPassive) {
    // passive はコスト行がない分、active より 1 行多く許容できる。
    // ただしキーワード行を出している場合は 1 行ぶん削ってフレーバー領域への被りを防ぐ。
    const passiveBudget = keywordLine ? 4 : 5;
    const { font: descFont, lineH: descLineH, lines: descLines } = fitDescription(description, passiveBudget);
    return (
      <g>
        {keywordTag}
        {nameLine}
        {descLines.map((line, i) => (
          <text key={i} x={x} y={y + keywordOffset + LINE_H + i * descLineH + Math.round(descFont * 0.9)}
                fontSize={descFont}
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {line}
          </text>
        ))}
        <rect x={x} y={y - 28} width={width} height={keywordOffset + LINE_H + descLineH * descLines.length + 14}
              fill="none" stroke="none" />
      </g>
    );
  }

  // 効果テキストブロックの最大行数 (default font 24 換算)。
  // キーワード行 (38px ~ 1.1 行分) を表示する分、許容行を 1 減らす。
  const MAX_TOTAL = keywordLine ? 5 : 6;
  // 構造化マナがあるか、タップが指定されていればアイコン行で描画 (折り返し不要)。
  const manaTotal = abilityManaCost !== undefined && abilityManaCost !== null ? manaCostTotal(abilityManaCost) : 0;
  const useManaIcons = (abilityManaCost !== undefined && abilityManaCost !== null) || !!abilityTap;
  const iconCount = manaTotal + (abilityTap ? 1 : 0);
  const costLineCount = useManaIcons ? 1 : Math.min(2, Math.max(1, Math.ceil(cost.length / 21)));
  const descBudget = Math.max(1, MAX_TOTAL - 1 - costLineCount);
  const { font: descFont, lineH: descLineH, lines: descLines } = fitDescription(description, descBudget);
  const costLines = useManaIcons ? [] : wrapJa(cost, 21, 2);
  const COST_ICON_SIZE = 26;
  const yOff = LINE_H; // コスト行は常に 1 段下に配置

  const baseY = y + keywordOffset;
  return (
    <g>
      {keywordTag}
      {nameLine}
      {/* コスト行: タップ + マナアイコン (構造化) or 文字列 (interim) */}
      {useManaIcons ? (
        <>
          <ManaCostSvgRow
            cost={abilityManaCost ?? {}}
            {...(abilityTap ? { tap: true } : {})}
            leftX={x}
            cy={baseY + yOff - 4}
            symbolSize={COST_ICON_SIZE}
          />
          {/* アイコン列の後ろに「:」を置いて、効果説明への橋渡し (MTG の活性化コスト表記) */}
          <text x={x + (iconCount * (COST_ICON_SIZE + 4)) + 2}
                y={baseY + yOff + 6} fontSize={DEFAULT_BODY_FONT} fontWeight="700"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            :
          </text>
        </>
      ) : (
        costLines.map((line, i) => (
          <text key={`c${i}`} x={x} y={baseY + (i + 1) * LINE_H + 6} fontSize={DEFAULT_BODY_FONT} fontWeight="700"
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {line}
          </text>
        ))
      )}
      {/* 説明行 (コスト下)、auto-fit したフォント / 行高で描画 */}
      {descLines.map((line, i) => {
        const yy = baseY + yOff + i * descLineH + Math.round(descFont * 0.9) + 12;
        return (
          <text key={`d${i}`} x={x} y={yy} fontSize={descFont}
                fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={TEXT_COLOR}>
            {i === 0 ? <tspan fontWeight="700" fill={LABEL_COLOR}>効果: </tspan> : null}
            {line}
          </text>
        );
      })}
      <rect x={x} y={y - 28} width={width}
            height={keywordOffset + yOff + descLineH * descLines.length + 24}
            fill="none" stroke="none" />
    </g>
  );
}

/**
 * flavor text を折り返して italic で描画。maxHeight を超える行はカットし、
 * 末尾を 「…」 に丸める。
 * attribution があれば最終行の下に MTG 風の "— {名前}" を右寄せ小字で添える。
 */
export function FlavorBlock(props: { x: number; y: number; width: number; maxHeight: number; text: string; attribution?: string | undefined }) {
  const { x, y, width, maxHeight, text, attribution } = props;
  const DEFAULT_FONT = 22;
  const DEFAULT_CHARS_PER_LINE = 21;
  const ATTR_FONT = 16;
  const ATTR_GAP = 6;
  const reserveForAttr = attribution ? ATTR_FONT + ATTR_GAP : 0;
  const availableHeight = maxHeight - reserveForAttr;

  // 説明文と同じ要領で auto-fit: 22 → 20 → 18 → 16 px の順で全文が収まる font を採用。
  // 省略 (…) は最後の砦としてだけ。
  function fitFlavor(): { font: number; lineH: number; lines: string[] } {
    const candidates = [22, 20, 18, 16];
    for (const font of candidates) {
      const lh = Math.round(font * 1.36);
      const cpl = Math.floor(DEFAULT_CHARS_PER_LINE * DEFAULT_FONT / font);
      const lines = wrapJa(text, cpl, 99);
      if (lines.length * lh <= availableHeight) return { font, lineH: lh, lines };
    }
    // 最小フォントでも超える → 最小フォントで budget まで詰めて省略 (極端な長文時のみ)
    const font = 16;
    const lh = Math.round(font * 1.36);
    const cpl = Math.floor(DEFAULT_CHARS_PER_LINE * DEFAULT_FONT / font);
    const budget = Math.max(1, Math.floor(availableHeight / lh));
    return { font, lineH: lh, lines: wrapJa(text, cpl, budget) };
  }
  const { font: FONT_SIZE, lineH: LINE_H, lines } = fitFlavor();
  const lastY = y + (lines.length - 1) * LINE_H;
  return (
    <g>
      {lines.map((line, i) => (
        <text key={i} x={x} y={y + i * LINE_H}
              fontSize={FONT_SIZE} fontStyle="italic" fontWeight="500"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif" fill={INK}>
          {line}
        </text>
      ))}
      {attribution && (
        <text x={x + width - 6} y={lastY + ATTR_FONT + ATTR_GAP}
              fontSize={ATTR_FONT} fontStyle="italic" fontWeight="500"
              fontFamily="'Hiragino Mincho ProN', 'Yu Mincho', serif"
              textAnchor="end" fill={INK_SOFT}>
          — {attribution}
        </text>
      )}
      <rect x={x - 4} y={y - (LINE_H - 8)} width={width} height={lines.length * LINE_H + 8 + reserveForAttr}
            fill="none" stroke="none" />
    </g>
  );
}

// 行頭禁則 (この文字で行が始まってはいけない)
const KINSOKU_HEAD_NG = '、。，．・）」』】〕｝〉》！？!?,.:;：；)]｝〉》';
// 行末禁則 (この文字で行が終わってはいけない)
const KINSOKU_TAIL_NG = '（「『【〔｛〈《([{';
// 自然な改行候補 (行末に来ると気持ちいい記号)
const WRAP_DELIMS = '、。 ・!?!?';

function wrapJa(text: string, perLine: number, maxLines: number): string[] {
  const out: string[] = [];
  let buf = '';
  const chars = Array.from(text);
  let i = 0;
  let consumed = 0;

  while (i < chars.length && out.length < maxLines) {
    const ch = chars[i]!;
    buf += ch;
    i++;
    consumed++;

    const atDelim = buf.length >= perLine && WRAP_DELIMS.includes(ch);
    const overLong = buf.length >= perLine + 3;
    if (!(atDelim || overLong)) continue;

    // 行末禁則: 行末が開き括弧なら切らずに続行
    if (KINSOKU_TAIL_NG.includes(ch)) continue;

    // 行頭禁則: 次の文字が禁則なら吸収してから切る (追い出し)
    while (i < chars.length && KINSOKU_HEAD_NG.includes(chars[i]!)) {
      buf += chars[i]!;
      i++;
      consumed++;
    }

    out.push(buf);
    buf = '';
  }
  if (buf.length > 0 && out.length < maxLines) {
    out.push(buf);
  }
  if (out.length >= maxLines && consumed < chars.length) {
    const last = out[maxLines - 1]!.replace(/[、。 ]*$/, '');
    out[maxLines - 1] = last + '…';
  }
  return out.slice(0, maxLines);
}

/** タイトル (cardName または displayName) の長さに応じてフォントサイズを縮める。
 *  Title bar 内の幅は W - 2*PADX - マナコスト幅 ≈ 540px。
 *  日本語フォントの幅は font-size の ~0.95 倍なので、概ね N 字 × size = 540 を解く。 */
export function titleFontSizeOf(text: string): number {
  const len = Array.from(text).length;
  if (len <= 8) return 38;
  if (len <= 10) return 34;
  if (len <= 12) return 30;
  if (len <= 14) return 26;
  return 22;
}
