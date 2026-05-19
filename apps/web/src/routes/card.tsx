import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Agent, AppBskyActorDefs } from '@atproto/api';
import type { CardType, DiagnosisResult, ManaCost } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord, putRecord, fetchFirstPageFollows } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import type { Rarity } from '@aozoraquest/core';
import { CARD_TYPES, COLORS, isRarity, manaCostColors, rollRarity } from '@aozoraquest/core';
import { bumpPower, hasSummoned, loadPointsState, type PointsState } from '@/lib/points';
import { recordCardDraw } from '@/lib/card-power';
import { generateCardText, getFallbackCardText, stripMarkdown, CardTextError, type CardText } from '@/lib/flavor-text';
import { cardToPngBlob, cardToShareBlob, downloadBlob } from '@/lib/card-export';
import { JobCard } from '@/components/job-card';
import { CardPackOverlay } from '@/components/card-pack-overlay';
import { CasinoIcon, DownloadIcon, ShareIcon } from '@/components/icons';
import { useCompose, useOnPosted } from '@/components/compose-modal';
import { Spinner } from '@/components/spinner';

type LoadState =
  | { status: 'checking' }
  | { status: 'no-diagnosis' }
  | { status: 'not-summoned' }
  | { status: 'ready'; result: DiagnosisResult; profile: ProfileBrief }
  | { status: 'error'; error: string };

interface ProfileBrief {
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
}

/** ローカル開発時 (vite dev) のみ true。あおぞらパワーの消費・残量チェックを丸ごとバイパスする。
 *  本番ビルド (vite build) では false 固定なので、prod に影響しない。 */
const IS_DEV = import.meta.env.DEV;

export function Card() {
  const session = useSession();
  const navigate = useNavigate();
  const [load, setLoad] = useState<LoadState>({ status: 'checking' });
  const [card, setCard] = useState<CardText | null>(null);
  const [rarity, setRarity] = useState<Rarity>('common');
  const [frameVariant, setFrameVariant] = useState<1 | 2>(1);
  const [flavorBusy, setFlavorBusy] = useState(false);
  const [power, setPower] = useState<PointsState | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<'idle' | 'downloading' | 'preparing' | 'posting' | 'posted'>('idle');
  const [shareErr, setShareErr] = useState<string | null>(null);
  const [genError, setGenError] = useState<{ stage: string; message: string; raw?: string } | null>(null);
  const [flavorAttribution, setFlavorAttribution] = useState<string | null>(null);
  // 引き直し演出: 抽選結果のレアリティをオーバーレイ表示中に保持。
  // llmDone が true になったらオーバーレイは reveal フェーズへ進む。
  // pending は LLM 完了後の結果バッファ。オーバーレイの onComplete で実 state に commit。
  const [drawing, setDrawing] = useState<{ rarity: Rarity; llmDone: boolean } | null>(null);
  const [pending, setPending] = useState<{
    card: CardText;
    attribution: string | null;
    variant: 1 | 2;
  } | null>(null);
  // 演出 → 新カード登場アニメーション用のキー。引き直しが reveal を終えるたびに +1。
  // <div key={...}> に渡して remount させ、CSS アニメを毎回再生する。
  const [revealAnimKey, setRevealAnimKey] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // 初回: session 確認 → 診断 + points ロード
  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    (async () => {
      try {
        // カード表示に必要な「軽量」3 件を並列で取る (analysis / 召喚済 / profile)。
        // フル points (~500 posts scan) は送信時の引き直しコストにのみ必要なので
        // 後段でバックグラウンドロードする。これでカード表示が ~1-2 秒早くなる。
        const [analysis, summoned, profile] = await Promise.all([
          getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
          hasSummoned(agent, did).catch(() => false),
          fetchProfile(agent, did).catch(() => null),
        ]);
        if (cancelled) return;
        if (!analysis) { setLoad({ status: 'no-diagnosis' }); return; }
        if (!summoned) { setLoad({ status: 'not-summoned' }); return; }
        // フル points を裏で取る (引き直しボタンの balance 表示に使う)。
        void loadPointsState(agent, did)
          .then((p) => { if (!cancelled) setPower(p); })
          .catch((e) => console.warn('points load failed', e));
        const pb: ProfileBrief = {
          did,
          handle: profile?.handle ?? session.handle ?? 'you',
          displayName: profile?.displayName || profile?.handle || session.handle || 'あなた',
          ...(profile?.avatar ? { avatar: profile.avatar } : {}),
        };
        setLoad({ status: 'ready', result: analysis, profile: pb });
        // PDS に既存のカード情報があればそのまま表示 (引き直しまで同じ)
        const hasSaved = analysis.flavorText || analysis.cardEffect || analysis.cardEffectName || analysis.cardRarity;
        if (hasSaved) {
          const savedRarity: Rarity = isRarity(analysis.cardRarity) ? analysis.cardRarity : 'common';
          setRarity(savedRarity);
          const savedVariant = analysis.cardFrameVariant === 2 ? 2 : 1;
          setFrameVariant(savedVariant);
          // 新フォーマット (name/description + manaCost/type/abilityCost) が入っていれば優先、
          // 無ければ fallback で穴埋め
          const fallback = getFallbackCardText(analysis.archetype, Date.now(), savedRarity);
          const cardName = analysis.cardName
            ? stripMarkdown(analysis.cardName)
            : fallback.cardName;
          const name = analysis.cardEffectName
            ? stripMarkdown(analysis.cardEffectName)
            : fallback.effect.name;
          const description = analysis.cardEffectDescription
            ? stripMarkdown(analysis.cardEffectDescription)
            : analysis.cardEffect
              ? (() => {
                  const m = analysis.cardEffect.match(/^[^\s―—–\-]+\s*[―—–\-]\s*(.+)$/);
                  return m ? stripMarkdown(m[1]!) : stripMarkdown(analysis.cardEffect);
                })()
              : fallback.effect.description;
          const cardType = isCardType(analysis.cardType) ? analysis.cardType : fallback.type;
          const manaCost: ManaCost = (analysis.cardManaCost && typeof analysis.cardManaCost === 'object')
            ? analysis.cardManaCost
            : fallback.manaCost;
          const abilityCost: ManaCost | null = (analysis.cardAbilityCost === null)
            ? null
            : (analysis.cardAbilityCost && typeof analysis.cardAbilityCost === 'object')
              ? analysis.cardAbilityCost
              : fallback.abilityCost;
          const abilityTap = typeof analysis.cardAbilityTap === 'boolean' ? analysis.cardAbilityTap : fallback.abilityTap;
          const keywords: string[] = Array.isArray(analysis.cardKeywords)
            ? analysis.cardKeywords.filter((s): s is string => typeof s === 'string')
            : fallback.keywords;
          const power = typeof analysis.cardPower === 'number' ? analysis.cardPower : fallback.power;
          const toughness = typeof analysis.cardToughness === 'number' ? analysis.cardToughness : fallback.toughness;
          setCard({
            cardName,
            type: cardType,
            manaCost,
            abilityCost,
            abilityTap,
            effect: { name, description },
            flavor: analysis.flavorText
              ? stripMarkdown(analysis.flavorText)
              : fallback.flavor,
            keywords,
            ...(power !== undefined ? { power } : {}),
            ...(toughness !== undefined ? { toughness } : {}),
            source: { kind: 'fallback' },
          });
          if (analysis.flavorAttribution) setFlavorAttribution(analysis.flavorAttribution);
        }
      } catch (e) {
        if (cancelled) return;
        setLoad({ status: 'error', error: String((e as Error)?.message ?? e) });
      }
    })();
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did, session.handle]);

  const result = load.status === 'ready' ? load.result : null;
  const profile = load.status === 'ready' ? load.profile : null;
  const artSrc = useMemo(() => (result ? `/card-art/${result.archetype}.jpg` : undefined), [result]);

  // アバターをロード時に dataURL 化しておく (rasterize 時の CORS 問題回避)。
  // fetch → blob → FileReader のパスが失敗したら XRPC sync.getBlob で自分の PDS
  // 経由で取得するフォールバックを用意。
  useEffect(() => {
    if (!profile?.avatar) return;
    if (avatarDataUrl) return;
    const url = profile.avatar;
    let cancelled = false;
    (async () => {
      const viaFetch = await fetchAsDataUrl(url);
      if (cancelled) return;
      if (viaFetch) { setAvatarDataUrl(viaFetch); return; }
      // XRPC 経由 fallback
      if (session.status !== 'signed-in' || !session.agent || !profile.did) return;
      const viaXrpc = await fetchBlobViaXrpc(session.agent, profile.did, url);
      if (cancelled) return;
      if (viaXrpc) setAvatarDataUrl(viaXrpc);
    })();
    return () => { cancelled = true; };
  }, [profile?.avatar, profile?.did, session.status, session.agent, avatarDataUrl]);

  // 診断読み込みが終わったら、PDS にカードが無いときだけ初回生成 (コスト 0)
  useEffect(() => {
    if (load.status !== 'ready') return;
    // 既に PDS にカード情報があればそれを見せる (引き直すまで変わらない)
    const hasSaved = load.result.flavorText || load.result.cardEffect || load.result.cardRarity;
    if (hasSaved) return;
    // 初回生成: rarity を抽選して生成 + 保存
    void regenerateCard({ initial: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status]);

  const regenerateCard = useCallback(async (opts: { initial?: boolean }) => {
    if (load.status !== 'ready') return;
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;

    // 明示的な引き直し (initial でない) は 1 あおぞらパワーを消費する。
    // ローカル開発時 (IS_DEV) は残量チェックも記録も丸ごとスキップして何枚でも引ける。
    if (!opts.initial && !IS_DEV) {
      if (!power || power.balance < 1) {
        console.warn('[card] power insufficient');
        return;
      }
      try {
        await recordCardDraw(agent, 'flavor-reroll');
      } catch (e) {
        console.warn('[card] recordCardDraw failed', e);
        return;
      }
      // 累積カウンタも +cardDraws (record 自体は recordCardDraw が書いた)
      if (session.did) void bumpPower(agent, session.did, { cardDraws: 1 });
      setPower((p) => p ? { ...p, cardDraws: p.cardDraws + 1, balance: Math.max(0, p.balance - 1) } : p);
    }

    setFlavorBusy(true);
    setGenError(null);

    // レアリティと枠 variant を抽選 (同期、即決定するので演出開始前に決められる)
    const nextRarity = rollRarity();
    const nextVariant: 1 | 2 = Math.random() < 0.5 ? 1 : 2;
    // 明示的な引き直しのみ演出を出す。初回 (PDS にカードが無い時の自動生成) は無音で。
    const showOverlay = !opts.initial;
    if (showOverlay) {
      setDrawing({ rarity: nextRarity, llmDone: false });
    }

    // 相互フォローの中からフレーバー発言者を選ぶ (失敗しても致命ではない)
    let attribution: string | null = null;
    if (session.did) {
      try {
        const follows = await fetchFirstPageFollows(agent, session.did);
        const mutuals = follows.filter((f) => f.isMutual);
        if (mutuals.length > 0) {
          const pick = mutuals[Math.floor(Math.random() * mutuals.length)]!;
          attribution = pick.displayName?.trim() || pick.handle;
        }
      } catch (e) {
        console.warn('[card] fetch follows for attribution failed', e);
      }
    }

    // LLM 生成 (失敗時は fallback テキストにフォールバック、演出は最後まで流す)
    let generated: CardText;
    try {
      generated = await generateCardText(load.result, nextRarity, {
        seed: Date.now(),
        displayName: load.profile.displayName,
      });
    } catch (e) {
      console.error('[card] regenerate card failed', e);
      if (e instanceof CardTextError) {
        setGenError({
          stage: e.stage,
          message: e.message,
          ...(e.raw !== undefined ? { raw: e.raw } : {}),
        });
      } else {
        setGenError({ stage: 'unknown', message: String((e as Error)?.message ?? e) });
      }
      generated = getFallbackCardText(load.result.archetype, Date.now(), nextRarity);
    }

    // PDS に一式保存 (新スキーマ: type + manaCost + abilityCost + effect 2 要素 + flavor)
    try {
      const now = new Date().toISOString();
      await putRecord(agent, COL.analysis, 'self', {
        ...load.result,
        cardName: generated.cardName,
        cardEffectName: generated.effect.name,
        cardEffectDescription: generated.effect.description,
        cardEffect: `${generated.effect.name} ― ${generated.effect.description}`,
        cardType: generated.type,
        cardManaCost: generated.manaCost,
        cardColors: manaCostColors(generated.manaCost) as Array<typeof COLORS[number]>,
        cardAbilityCost: generated.abilityCost,
        cardAbilityTap: generated.abilityTap,
        cardKeywords: generated.keywords,
        ...(generated.power !== undefined ? { cardPower: generated.power } : {}),
        ...(generated.toughness !== undefined ? { cardToughness: generated.toughness } : {}),
        flavorText: generated.flavor,
        ...(attribution ? { flavorAttribution: attribution } : {}),
        cardRarity: nextRarity,
        cardFrameVariant: nextVariant,
        cardDrawnAt: now,
        flavorGeneratedAt: now,
      });
    } catch (e) {
      console.warn('[card] save card to PDS failed', e);
    }

    setFlavorBusy(false);

    if (showOverlay) {
      // 演出を出してる間は state を温存して、onDrawComplete で一括コミット。
      // これでオーバーレイ下の旧カードが先に変わって "ネタバレ" するのを防ぐ。
      setPending({ card: generated, attribution, variant: nextVariant });
      setDrawing((d) => (d ? { ...d, llmDone: true } : null));
    } else {
      // initial 経路 (PDS から復元できなかった初回生成): 即時コミット
      setRarity(nextRarity);
      setFrameVariant(nextVariant);
      setCard(generated);
      setFlavorAttribution(attribution);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.status, session.status, session.agent, power]);

  /** カード抽選演出が reveal を終えた瞬間に pending を実 state にコミット。 */
  const onDrawComplete = useCallback(() => {
    if (drawing && pending) {
      setRevealAnimKey((k) => k + 1);
      setRarity(drawing.rarity);
      setFrameVariant(pending.variant);
      setCard(pending.card);
      setFlavorAttribution(pending.attribution);
    }
    setDrawing(null);
    setPending(null);
  }, [drawing, pending]);

  const onDownload = useCallback(async () => {
    if (!svgRef.current || !result) return;
    setShareBusy('downloading');
    setShareErr(null);
    try {
      const blob = await cardToPngBlob(svgRef.current);
      downloadBlob(blob, `aozoraquest-${result.archetype}.png`);
    } catch (e) {
      setShareErr(String((e as Error)?.message ?? e));
    } finally {
      setShareBusy('idle');
    }
  }, [result]);

  const { openCompose } = useCompose();

  // compose-modal が投稿成功を通知してきたら、card 側の状態も "posted" に倒す。
  // image 経由の投稿でも notifyPosted は走るので useOnPosted で受ける。
  useOnPosted(() => {
    if (shareBusy === 'preparing') {
      // モーダルを開いただけで送信前にイベントが来ることはないが念のため
      return;
    }
    setShareBusy('posted');
  });

  const onPost = useCallback(async () => {
    if (!svgRef.current || !result || !profile) return;
    if (session.status !== 'signed-in' || !session.agent) return;
    setShareBusy('preparing');
    setShareErr(null);
    try {
      // 投稿用は WebP で 100KB 以下に圧縮 (Bluesky の表示でも十分な解像度)
      const blob = await cardToShareBlob(svgRef.current);
      const initialText = `${displayArchetype(result.archetype)} の気質が出ました。 #AozoraQuest`;
      const alt = `${profile.displayName} の診断カード。職業は${displayArchetype(result.archetype)}。`;
      // 既存の投稿モーダルに blob + 既定テキストを渡して、ユーザー編集 → 送信。
      // モーダル送信時は createPostWithImage 経路を通るので tag (#AozoraQuest)
      // も automatic に facet 化される (compose-modal 側で source='card' を判定)。
      openCompose({
        initialText,
        image: { blob, alt, source: 'card' },
      });
      // モーダルを開いた後はそちらに主導権を渡す。busy 状態は idle に戻して
      // ボタン disable を解除 (ユーザーがモーダルでキャンセルしてもボタンが
      // 押せるように)。posted への遷移は useOnPosted で受ける。
      setShareBusy('idle');
    } catch (e) {
      setShareErr(String((e as Error)?.message ?? e));
      setShareBusy('idle');
    }
  }, [result, profile, session.status, session.agent, openCompose]);

  if (session.status !== 'signed-in') {
    return (
      <div>
        <h2>カード</h2>
        <p>まずはログインしてください。</p>
      </div>
    );
  }

  if (load.status === 'checking') {
    return (
      <div style={{ padding: '2em 0', textAlign: 'center' }}>
        <Spinner size={28} label="カード情報を読み込み中…" />
      </div>
    );
  }

  if (load.status === 'no-diagnosis') {
    return (
      <div style={{ textAlign: 'center', marginTop: '1em' }}>
        <p>まだ気質が調べられていません。</p>
        <Link to="/me"><button>気質を調べる</button></Link>
      </div>
    );
  }

  if (load.status === 'not-summoned') {
    return (
      <div style={{ textAlign: 'center', marginTop: '1em' }}>
        <p>ブルスコンを召喚してからカードを作れる。</p>
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          アプリから投稿を重ね、精霊ブルスコンを呼び出そう。
        </p>
        <Link to="/spirit"><button>精霊の社へ</button></Link>
      </div>
    );
  }

  if (load.status === 'error') {
    return <p style={{ color: 'var(--color-danger)' }}>エラー: {load.error}</p>;
  }

  // ready
  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>ブルスコンカード</h2>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
        ブルスコンがピックアップしたあなたのカード
      </p>

      <div
        className={`card-stage${drawing ? ' card-stage--hidden' : ''}`}
        style={{ margin: '1em auto', maxWidth: 420, width: '100%' }}
        key={revealAnimKey}
      >
        <JobCard
          ref={svgRef}
          result={result!}
          effectName={card?.effect.name ?? ''}
          effectCost={formatAbilityCostForDisplay(card?.abilityCost ?? null)}
          effectDescription={card?.effect.description ?? '…'}
          flavorText={card?.flavor ?? '…'}
          flavorAttribution={flavorAttribution ?? undefined}
          rarity={rarity}
          frameVariant={frameVariant}
          {...(card?.type ? { cardType: card.type } : {})}
          {...(card?.manaCost ? { manaCost: card.manaCost } : {})}
          {...(card?.abilityCost !== undefined ? { abilityCost: card.abilityCost } : {})}
          {...(card?.abilityTap ? { abilityTap: true } : {})}
          {...(card?.cardName ? { cardName: card.cardName } : {})}
          {...(card?.keywords ? { keywords: card.keywords } : {})}
          {...(card?.power !== undefined ? { power: card.power } : {})}
          {...(card?.toughness !== undefined ? { toughness: card.toughness } : {})}
          displayName={profile!.displayName}
          handle={profile!.handle}
          artSrc={artSrc}
          avatarSrc={avatarDataUrl ?? profile!.avatar}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>

      {/* power 表示行は常に同じ高さを確保。読込中は Spinner、完了後に balance 表示。
       *  null → 値 で行が突然出現してレイアウトがズレる体感を防ぐ。 */}
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', marginTop: '0.4em', minHeight: '1.6em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4em' }}>
        あおぞらパワー:
        {power ? (
          <>
            <span style={{ color: 'var(--color-accent)', fontFamily: 'ui-monospace, monospace' }}>{power.balance}</span>
            <span style={{ opacity: 0.6 }}>(引き直しで 1 消費)</span>
          </>
        ) : (
          <Spinner size={14} label="計測中…" />
        )}
      </p>

      <div style={{ display: 'flex', gap: '0.6em', justifyContent: 'center', flexWrap: 'wrap', marginTop: '1em' }}>
        <button
          disabled={flavorBusy || !!drawing || (!IS_DEV && (!power || power.balance < 1))}
          onClick={() => void regenerateCard({ initial: false })}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <CasinoIcon size={16} />
            {drawing ? '抽選中…' : flavorBusy ? '詩を探している…' : IS_DEV ? '引き直す (dev: 無制限)' : (power && power.balance < 1) ? '引き直せない' : '引き直す (−1)'}
          </span>
        </button>
        <button disabled={shareBusy !== 'idle' || !card} onClick={() => void onDownload()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <DownloadIcon size={16} />
            {shareBusy === 'downloading' ? '書き出し中…' : '画像として保存'}
          </span>
        </button>
        <button disabled={shareBusy !== 'idle' || !card} onClick={() => void onPost()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
            <ShareIcon size={16} />
            {shareBusy === 'preparing' ? '画像準備中…' : shareBusy === 'posting' ? '投稿中…' : shareBusy === 'posted' ? '投稿しました' : 'Bluesky に投稿'}
          </span>
        </button>
      </div>

      {shareErr && (
        <p style={{ color: 'var(--color-danger)', fontSize: '0.85em', marginTop: '0.6em' }}>
          うまくいきませんでした: {shareErr}
        </p>
      )}

      {genError && (
        <div
          style={{
            color: 'var(--color-danger)',
            fontSize: '0.85em',
            marginTop: '0.6em',
            padding: '0.6em 0.8em',
            border: '1px solid var(--color-danger)',
            borderRadius: 6,
            textAlign: 'left',
            maxWidth: 420,
            margin: '0.6em auto 0',
          }}
        >
          <div style={{ fontWeight: 600 }}>
            カード生成に失敗しました (stage: {genError.stage})
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>
            {genError.message}
          </div>
          {genError.raw && (
            <details style={{ marginTop: '0.4em' }}>
              <summary style={{ cursor: 'pointer' }}>LLM 生の出力</summary>
              <pre style={{ fontSize: '0.8em', whiteSpace: 'pre-wrap', marginTop: '0.3em' }}>{genError.raw}</pre>
            </details>
          )}
        </div>
      )}

      {shareBusy === 'posted' && (
        <p style={{ marginTop: '0.6em', fontSize: '0.9em' }}>
          投稿しました。<button className="secondary" onClick={() => navigate('/me')}>戻る</button>
        </p>
      )}

      <div style={{ marginTop: '2em' }}>
        <Link to="/me">← 自分の気質に戻る</Link>
      </div>

      {drawing && (
        <CardPackOverlay
          rarity={drawing.rarity}
          llmDone={drawing.llmDone}
          onComplete={onDrawComplete}
        />
      )}
    </div>
  );
}

function isCardType(s: unknown): s is CardType {
  return typeof s === 'string' && (CARD_TYPES as readonly string[]).includes(s);
}

/** JobCard の旧 `effectCost: string` プロパティ用に、ManaCost を簡易表記する。
 *  commit 4 でマナアイコン描画に置き換わるまでの一時的な表示。 */
function formatAbilityCostForDisplay(cost: ManaCost | null): string {
  if (!cost) return 'なし';
  const parts: string[] = [];
  if (cost.generic && cost.generic > 0) parts.push(String(cost.generic));
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) {
    const n = cost[c] ?? 0;
    for (let i = 0; i < n; i++) parts.push(c);
  }
  return parts.length === 0 ? 'なし' : parts.join('');
}

async function fetchProfile(agent: Agent, did: string): Promise<AppBskyActorDefs.ProfileViewDetailed | null> {
  try {
    const res = await agent.getProfile({ actor: did });
    return res.data;
  } catch {
    return null;
  }
}

/** fetch → blob → dataURL。CORS 通れば成功、駄目なら null。 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[card] avatar fetch failed, will try XRPC fallback', e);
    return null;
  }
}

/** Bluesky 形式 URL から cid を取って XRPC sync.getBlob 経由で取得。
 *  URL 例: https://cdn.bsky.app/img/avatar/plain/{did}/{cid}@jpeg */
async function fetchBlobViaXrpc(agent: Agent, did: string, url: string): Promise<string | null> {
  const m = url.match(/\/([a-z0-9]{20,})(?:@[\w.]+)?(?:\?.*)?$/);
  if (!m) return null;
  const cid = m[1]!;
  try {
    const res = await agent.com.atproto.sync.getBlob({ did, cid });
    const bytes = res.data as unknown as Uint8Array;
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([ab], { type: 'image/jpeg' });
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('[card] avatar XRPC fetch failed', e);
    return null;
  }
}

function displayArchetype(id: string): string {
  // jobDisplayName を使わずここで軽く寄せる (import を増やしたくない程度の都合)
  const map: Record<string, string> = {
    sage: '賢者', mage: '魔法使い', shogun: '将軍', bard: '吟遊詩人',
    seer: '予言者', poet: '詩人', paladin: '聖騎士', explorer: '冒険者',
    warrior: '戦士', guardian: '守護者', fighter: '武闘家', artist: '芸術家',
    captain: '隊長', miko: '巫女', ninja: '忍者', performer: '遊び人',
  };
  return map[id] ?? '旅人';
}
