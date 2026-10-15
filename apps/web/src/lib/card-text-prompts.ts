/** 能力 / フレーバー生成用の LLM プロンプト組み立て。 flavor-text.ts から分割。 */
import type { DiagnosisResult, Rarity } from '@aozoraquest/core';
import { jobDisplayName, JOBS_BY_ID, RARITY_GUIDANCE, RARITY_LABEL } from '@aozoraquest/core';
import { pickEffectInspirations } from './card-text-effect-samples';
import { ABILITY_EXAMPLE, ARTIFACT_ABILITY_EXAMPLE, CREATURE_ABILITY_EXAMPLE, FLAVOR_EXAMPLE, exampleManaCostFor, exampleAbilityCostFor, exampleKeywordsFor, examplePowerFor, exampleToughnessFor, exampleCardNameFor, type CardTypeJa } from './card-text-examples';
import { MANA_TOTAL_RANGE, COLOR_NAME_JA, SNS_HINT_ABILITY, SNS_HINT_FLAVOR, TONE_LABEL, TONE_DIRECTIVE, STRUCTURE_PATTERNS, type Tone } from './card-text-themes';

/** 能力 (ルールテキスト) 生成用プロンプト。タイプは JS 側で確定済みのものを受け取り、LLM には固定として渡す。
 *  theme と structure も毎回ランダムに変えて、似通った出力に収束しないようにする。 */
export function buildAbilityPrompt(
  result: DiagnosisResult,
  rarity: Rarity,
  tone: Tone,
  fixedType: CardTypeJa,
  theme: string,
  structure: typeof STRUCTURE_PATTERNS[number],
): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];
  const job = JOBS_BY_ID[result.archetype];
  const primaryName = COLOR_NAME_JA[job.primaryColor];
  const [minMana, maxMana] = MANA_TOTAL_RANGE[rarity];
  const isCreature = fixedType === 'クリーチャー';
  const isArtifact = fixedType === 'アーティファクト';
  const isSpell = fixedType === 'インスタント' || fixedType === 'ソーサリー';

  const typeDescription =
    isCreature
      ? 'クリーチャー: あなたのアカウント上に常駐する「実体・キャラクター」。能力は「登場時 1 回」または「コストを払って起動」または「常時」。'
      : fixedType === 'インスタント'
        ? 'インスタント: 誰かの投稿への瞬発的 1 度きりの介入 (リプライ/引用リポスト/ミュート/通知/公開などの一手)。'
        : fixedType === 'ソーサリー'
          ? 'ソーサリー: 一度きりの大きな能動操作 (フォロワー全員へのアナウンス、フィードの再構築、キャンペーン投稿など)。'
          : 'アーティファクト: SNS 上の「設置した道具」(ボット/自動リプライ機/ピン留めの拡声器/予約投稿スケジューラ/外部連携 API/ハッシュタグ・トラッカー/ミュートフィルタ等)。基本的に無属性。';

  // 構造に合致する効果サンプルを 3 件ランダムに抽出 → few-shot で発想の幅を提示。
  const inspirations = pickEffectInspirations(structure.id, 3);

  const system = [
    'あなたは Bluesky (SNS) を舞台にしたトレカのルールテキストを書くゲームデザイナーです。日本語で 1 枚分のカードを書きます。',
    SNS_HINT_ABILITY,
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    '',
    `今回の切り口テーマ: 「${theme}」 — このテーマを発想の起点に、関連する SNS 現象を効果に織り込む (テーマ語句をそのまま書く必要はない)。`,
    `今回の効果構造: ${structure.label} — ${structure.description}。必ずこの型に従う。`,
    '',
    '▼ 効果のインスピレーション (同じ構造の参考例。これらと同じ単語・場面を使わず、テーマ「' + theme + '」に基づく新しい効果を書く):',
    ...inspirations.map((s) => `  - ${s}`),
    '',
    `今回のカードタイプは「${fixedType}」で固定です (変更不可)。`,
    typeDescription,
    '',
    ...(isCreature ? [
      'クリーチャー固有ルール:',
      '- カード名は「実体・存在・キャラクター」を表す名詞句にする。例: 「影忍びの夜想曲」「黄昏の編纂者」「微睡の歩哨」。動詞で終わる行為名 (「〜を紡ぐ」「〜を放つ」) は禁止。',
      '- 説明文は次のいずれか (混在 OK):',
      '  (a) 登場時能力: 「このクリーチャーが場に出たとき、〜する」 — 1 回だけ発動',
      '  (b) 起動型能力: 「〜する」(起動コスト欄にマナを書く)',
      '  (c) 静的能力: 「〜の間、〜する」「〜があるたびに、〜」',
      '  (d) 能力なし (キーワードだけで戦う) — その場合は説明に「〜」程度の短い宣言を書くか、キーワードと整合する短い説明',
      '- キーワード能力 (0-3 個まで、SNS 文脈に合うものを選ぶ):',
      '    飛行 (タイムラインを飛び越えて届く) / 警戒 (通知を見逃さない) / 先制攻撃 (リプライを先に届ける) /',
      '    速攻 (登場直後から動ける) / トランプル (フォロワー数の差を相手に押し付ける) / 接死 (1 撃で対象をミュートに追い込む) /',
      '    絆魂 (与えた影響と同量、自分のフォロワーが増える) / 二段攻撃 (1 アクションで 2 度発動) /',
      '    威迫 (フォロワー 2 人以上でないと反応できない) / 到達 (引用リポストの連鎖を断ち切れる) /',
      '    呪禁 (相手から指定されない) / 護法 (対象にされた時 1 マナの対価を要求) / 防衛 (フォロワーを守る、能動行動不可)',
      '- パワー / タフネス: 1-7 の整数。マナコスト総量 + キーワード数 を概ね反映 (例: 1 マナ 1/1、4 マナ 3/3、6 マナ 5/5)。',
    ] : isArtifact ? [
      'アーティファクト固有ルール:',
      '- カード名は「道具・装置・仕組み」を表す名詞句。例: 「ピン留めの拡声器」「予約投稿スケジューラ」「自動引用ボット」。',
      '- マナコストは色マナを含めず、generic のみで構成すること (無色)。',
      '- 起動コストを 1 マナ以上設定して、「{コスト}: 〜する」の起動型能力として書くのが基本。',
      '- キーワード能力なし、パワー / タフネスなし (該当欄は「なし」)。',
    ] : isSpell ? [
      `${fixedType}固有ルール:`,
      '- カード名は「行為・出来事」を表す名詞句。',
      '- 説明は能動動詞で終わる 1 度きりの効果を書く。',
      '- 起動コストは原則「なし」(マナコストで支払い済み)。説明文に代償行為 (下書き 1 つ破棄など) を埋め込んだ場合のみ追加コストとして書く。',
      '- キーワード能力なし、パワー / タフネスなし (該当欄は「なし」)。',
    ] : []),
    '',
    '',
    '色 (属性) の使い方:',
    `- このジョブの primary color は「${primaryName}」(${job.primaryColor})。クリーチャー / インスタント / ソーサリーでは ${primaryName}1 以上を必ず含める。`,
    '- 能力テーマに応じて補助色を 1 色まで足してよい (合計 2 色まで)。3 色以上は禁止。',
    '- アーティファクトのみ、色マナは 0 にして generic だけで構成する。',
    '',
    'マナコスト表記:',
    '- 例: 「赤1」「白2」「青1 generic1」「generic3」「なし」',
    '- 1 色マナが N 個欲しい時は「赤N」と数字で書く。',
    '- generic マナは「generic N」と書く。',
    '',
    `今回のタイプ「${fixedType}」では、マナコスト・色は次のように決める:`,
    isArtifact
      ? `- 無色 (アーティファクト)。マナコスト = 「generic${Math.max(minMana, 1)}」のように generic だけで合計 ${minMana}-${maxMana} マナ。色マナは入れない。`
      : `- ${primaryName} (${job.primaryColor}) を必ず色マナとして 1 つ以上含める。補助色を 1 色まで足してよい (合計 2 色まで)。3 色以上禁止。`,
    '',
    `今回のタイプ「${fixedType}」の起動コスト:`,
    isCreature
      ? '- 常時/状態能力 or 登場時能力なら「なし」。タップして発動する起動型能力なら「タップ」(または「T」) と書く。マナを伴うなら「タップ generic1」のようにマナと組み合わせる。'
      : isArtifact
        ? `- 道具を「起動」する想定。タップを含めるのが基本: 「タップ」「タップ generic1」「generic2」など。色マナを使ってもよいが、無色なら generic のみ。`
        : '- 原則「なし」(マナコストで支払い済み)。説明文上どうしても代償が必要な場合のみ「追加コスト」として書く。タップは使わない (場に居続けるカードではないため)。',
    '',
    `出力は次の ${isCreature ? 8 : 5} 行のみ。前置き・Markdown・括弧類・箇条書き禁止。`,
    'タイプ行は出力しない (固定値なので)。',
    `マナコスト: <合計 ${minMana}-${maxMana} マナ。${isArtifact ? 'generic のみ' : `${primaryName}1 以上を含む`}>`,
    `カード名: <4〜12字。${isCreature ? '実体・存在を表す名詞句' : '行為・出来事・物を表す名詞句'}>`,
    '能力名: <2〜8字。短いキーワード。例「潜影」「星読み」>',
    '起動コスト: <マナ表記、または「なし」>',
    '説明: <20〜50字。Bluesky の現象に基づくゲーム効果。MTG 固有の領域語 (山札/手札/墓地/場/プレイヤー/ターン/呪文/召喚) は禁止>',
    ...(isCreature ? [
      'キーワード: <カンマ区切り 0-3 個、または「なし」。例「飛行, 警戒」>',
      'パワー: <整数 1-7>',
      'タフネス: <整数 1-7>',
    ] : []),
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]} / 形式参考。タイプは出力しない):`,
    `マナコスト: ${exampleManaCostFor(rarity, job.primaryColor, fixedType)}`,
    `カード名: ${exampleCardNameFor(result.archetype)}`,
    (isCreature ? CREATURE_ABILITY_EXAMPLE : isArtifact ? ARTIFACT_ABILITY_EXAMPLE : ABILITY_EXAMPLE)[rarity][tone],
    `起動コスト: ${exampleAbilityCostFor(rarity, job.primaryColor, fixedType)}`,
    ...(isCreature ? [
      `キーワード: ${exampleKeywordsFor(rarity)}`,
      `パワー: ${examplePowerFor(rarity)}`,
      `タフネス: ${exampleToughnessFor(rarity)}`,
    ] : []),
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `カードタイプ: ${fixedType} (固定・変更不可)`,
    ...(isArtifact ? [] : [`primary color: ${primaryName} (${job.primaryColor}) — 色マナとして必ず含める`]),
    `希少度: ${rarityLabel} (マナコスト合計 ${minMana}-${maxMana})`,
    `雰囲気: ${RARITY_GUIDANCE[rarity]}`,
    `トーン: ${TONE_LABEL[tone]}`,
    `切り口テーマ: ${theme}`,
    `効果構造: ${structure.label} (${structure.description})`,
    '',
    `上記に合う 1 枚分の Bluesky 世界の「${fixedType}」カードを書いて。タイプ行は出力不要。`,
    '効果は必ず Bluesky の現象 (投稿/いいね/リポスト/フォロー/通知/フィード/タイムライン/下書き/アーカイブ/ハッシュタグ/スレッド/ミュート/ブロック/引用/ピン留め等) に根ざすこと。マナ/属性/コスト/カードタイプの TCG メカニクス語は使ってよい。ただし MTG 固有の領域語 (山札/手札/墓地/場/プレイヤー/ターン/呪文/召喚) は説明文で使わない。',
    'インスピレーション欄の参考例とは別の単語・場面で、「切り口テーマ」に紐づく効果を書く。',
  ].join('\n');

  return { system, user };
}

/** フレーバーテキスト生成用プロンプト。トーンに沿った 1 文。displayName を自然に織り込ませる。 */
export function buildFlavorPrompt(result: DiagnosisResult, rarity: Rarity, cardName: string, abilityName: string, tone: Tone, displayName?: string): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];

  const system = [
    'あなたはトレカのフレーバー作家です。能力の直下に添える 1 文を日本語で書きます。',
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    'ゲーム効果は書かない。詩的でありながら、上のトーン指示を守る。',
    'ユーザー名が与えられた場合、可能なら自然な形で 1 度だけ織り込む (「〜は…した」のような主語化)。',
    '不自然になるなら無理に入れず、第三者視点で書いてよい。',
    SNS_HINT_FLAVOR,
    '',
    '出力は次の 1 行のみ。前置き・Markdown・括弧類禁止。',
    'フレーバー: <40〜70字>',
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]}):`,
    `フレーバー: ${FLAVOR_EXAMPLE[rarity][tone]}`,
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `カード名: ${cardName}`,
    `能力名: ${abilityName}`,
    `希少度: ${rarityLabel}`,
    `トーン: ${TONE_LABEL[tone]}`,
    ...(displayName ? [`ユーザー名: ${displayName}`] : []),
    '',
    `「${cardName}」のフレーバーを 1 文で書いて。`,
  ].join('\n');

  return { system, user };
}
