import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { createPost, createPostWithImages, MAX_POST_IMAGES, type ReplyRef } from '@/lib/atproto';
import { compressImage } from '@/lib/image-compress';
import { TextField } from './text-field';
import { processSelfPost } from '@/lib/post-processor';
import { bumpPower } from '@/lib/points';
import { LevelUpOverlay, notifyLevelUp } from './level-up-overlay';
import { POST_MAX_LENGTH, jobDisplayName } from '@aozoraquest/core';

export interface ComposeReplyTo {
  parent: { uri: string; cid: string };
  root: { uri: string; cid: string };
  author: string;
  text: string;
}

/**
 * compose-modal で添付できる画像。card 共有経由でも user 添付経由でも同じ形。
 * - blob: そのまま uploadBlob にかける本体
 * - alt: a11y 用代替テキスト。空でも投稿可
 * - source: 'card' なら #AozoraQuest facet を自動付与する
 */
export interface ComposeAttachedImage {
  blob: Blob;
  alt: string;
  source: 'card' | 'user';
}

export interface ComposeOpenOptions {
  replyTo?: ComposeReplyTo;
  initialText?: string;
  image?: ComposeAttachedImage;
}

// 投稿成功イベント (タイムライン側が購読して自分の投稿をすぐ反映する)
type PostedListener = () => void;
const postedListeners = new Set<PostedListener>();
function notifyPosted() {
  for (const cb of postedListeners) {
    try { cb(); } catch (e) { console.warn('posted listener failed', e); }
  }
}

/** 自分が投稿を作成した直後に呼ばれるコールバックを登録する。return で解除。 */
export function useOnPosted(cb: PostedListener) {
  useEffect(() => {
    postedListeners.add(cb);
    return () => {
      postedListeners.delete(cb);
    };
  }, [cb]);
}

interface ComposeCtx {
  /** replyTo のみの旧シグネチャ + opts オブジェクトの新シグネチャ両対応。 */
  openCompose: (optsOrReplyTo?: ComposeOpenOptions | ComposeReplyTo) => void;
  closeCompose: () => void;
}

const ComposeContext = createContext<ComposeCtx>({ openCompose: () => {}, closeCompose: () => {} });

export function useCompose(): ComposeCtx {
  return useContext(ComposeContext);
}

interface ProviderState {
  open: boolean;
  replyTo: ComposeReplyTo | null;
  initialText: string;
  initialImage: ComposeAttachedImage | null;
}

/** 引数が ReplyRef 形式 (parent + root を持つ) か新オプション形式かを判別。 */
function isReplyTo(v: unknown): v is ComposeReplyTo {
  return !!v && typeof v === 'object' && 'parent' in v && 'root' in v;
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProviderState>({
    open: false, replyTo: null, initialText: '', initialImage: null,
  });

  const openCompose = useCallback((arg?: ComposeOpenOptions | ComposeReplyTo) => {
    if (!arg) {
      setState({ open: true, replyTo: null, initialText: '', initialImage: null });
      return;
    }
    if (isReplyTo(arg)) {
      setState({ open: true, replyTo: arg, initialText: '', initialImage: null });
      return;
    }
    setState({
      open: true,
      replyTo: arg.replyTo ?? null,
      initialText: arg.initialText ?? '',
      initialImage: arg.image ?? null,
    });
  }, []);

  const closeCompose = useCallback(() => {
    setState({ open: false, replyTo: null, initialText: '', initialImage: null });
  }, []);

  return (
    <ComposeContext.Provider value={{ openCompose, closeCompose }}>
      {children}
      {state.open && (
        <ComposeDialog
          replyTo={state.replyTo}
          initialText={state.initialText}
          initialImage={state.initialImage}
          onClose={closeCompose}
        />
      )}
      <LevelUpOverlay />
    </ComposeContext.Provider>
  );
}

interface DialogState {
  blob: Blob;
  alt: string;
  source: 'card' | 'user';
  /** プレビュー用の objectURL。dialog unmount 時に revoke する */
  previewUrl: string;
}

/** ファイル選択ダイアログに渡す accept。iPhone の HEIC や撮影写真も選べるよう
 *  image/* を基本に、明示形式も併記する (一部 OS で image/* だけだと挙動が鈍い)。 */
const FILE_ACCEPT = 'image/*,image/heic,image/heif';
/** 添付を受け付ける type (HEIC/HEIF を含む。SVG や非画像は除外)。
 *  iOS は type が空文字で来ることがあるのでそれも許し、最終的な可否は
 *  「圧縮できて Bluesky 対応形式になったか」で判定する (onFileChange 参照)。 */
const ATTACHABLE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
];
function isAttachableImage(file: File): boolean {
  return file.type === '' || ATTACHABLE_TYPES.includes(file.type);
}
/** Bluesky uploadBlob の上限は約 1MB。少しマージン取って 950KB を上限警告ラインに。 */
const MAX_IMAGE_BYTES = 950_000;

/** 画像プレビュー行の操作ボタン (↑ ↓ 削除)。親が 0.75em と小さいので rem 基準で
 *  独立に大きさを決め、モバイルのタップ領域 (≈40px) を確保する。 */
const IMG_CTRL_BTN: CSSProperties = {
  fontSize: '0.95rem',
  minHeight: '2.6em',
  minWidth: '2.6em',
  padding: '0.2em 0.6em',
  lineHeight: 1,
};

/** 投稿フォーム。`variant='modal'` は中央モーダル、`variant='column'` は
 *  ワークスペースの 1 カラムとして描画する (PC 左レールの投稿ボタンから開く)。
 *  state / 画像処理 / 送信ロジックは共通で、外枠 (overlay or column) だけ分岐。 */
function ComposeDialog({
  replyTo,
  initialText,
  initialImage,
  onClose,
  variant = 'modal',
}: {
  replyTo: ComposeReplyTo | null;
  initialText: string;
  initialImage: ComposeAttachedImage | null;
  onClose: () => void;
  variant?: 'modal' | 'column';
}) {
  const session = useSession();
  const [text, setText] = useState(initialText);
  const [images, setImages] = useState<DialogState[]>(() => {
    if (!initialImage) return [];
    return [{
      blob: initialImage.blob,
      alt: initialImage.alt,
      source: initialImage.source,
      previewUrl: URL.createObjectURL(initialImage.blob),
    }];
  });
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  // 複数枚を逐次処理する間「進んでいる」ことを見せる (高解像度 4 枚は数秒かかり、固まったと誤解されるため)
  const [compressProgress, setCompressProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<DialogState[]>(images);
  imagesRef.current = images;
  // 圧縮中に dialog が閉じたら、完了後の setState / objectURL 生成を抑止する
  const mountedRef = useRef(true);

  // 画像 objectURL を unmount で revoke (両 variant 共通)。
  // モーダルのみ ESC で閉じる + 背面スクロールをロックする (カラムは常設なので不要)。
  useEffect(() => {
    if (variant !== 'modal') {
      return () => {
        mountedRef.current = false;
        for (const im of imagesRef.current) URL.revokeObjectURL(im.previewUrl);
      };
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      // 最後にセットされてた image 群の url をすべて revoke
      for (const im of imagesRef.current) URL.revokeObjectURL(im.previewUrl);
    };
  }, [loading, onClose, variant]);

  const agent = session.agent;
  if (!agent) {
    // 非サインイン時は開かない想定だが念のため
    return null;
  }

  function pickImage() {
    fileInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = ''; // 同じファイルを再選択しても change が起きるように
    if (selected.length === 0) return;

    // 既存枚数 + 今回分が上限を超えるぶんは切り捨てて警告
    const remaining = MAX_POST_IMAGES - imagesRef.current.length;
    if (remaining <= 0) {
      setErr(`画像は最大 ${MAX_POST_IMAGES} 枚までです。`);
      return;
    }
    const attachable = selected.filter(isAttachableImage);
    const files = attachable.slice(0, remaining);
    // スキップ理由を内訳で集計 (1 つの文言に上書きしない)
    const unsupported = selected.length - attachable.length; // 非対応形式
    const overLimit = attachable.length - files.length;       // 上限超過で入りきらない
    if (files.length === 0) {
      setErr('画像ファイルを選んでください。');
      return;
    }

    setCompressing(true);
    setCompressProgress({ done: 0, total: files.length });
    const added: DialogState[] = [];
    let sizeSkipped = 0;
    try {
      let done = 0;
      for (const file of files) {
        // 大きい画像は弾かず、lossy WebP に圧縮して上限内に収める (GIF は変換しない)。
        let blob: Blob = file;
        try {
          const result = await compressImage(file, { maxBytes: MAX_IMAGE_BYTES });
          blob = result.blob;
        } catch (err) {
          console.warn('[compose] image compress failed, use original', err);
        }
        if (mountedRef.current) setCompressProgress({ done: ++done, total: files.length });
        if (blob.size > MAX_IMAGE_BYTES) {
          sizeSkipped += 1;
          // 原因切り分け (圧縮が効いていない / 効いても収まらない) は開発者向け。文言には出さない。
          console.warn(`[compose] 添付不可: 圧縮後も ${(blob.size / 1000).toFixed(0)}KB で上限 ${(MAX_IMAGE_BYTES / 1000).toFixed(0)}KB 超過`);
          continue;
        }
        added.push({ blob, alt: '', source: 'user', previewUrl: URL.createObjectURL(blob) });
      }
    } finally {
      if (mountedRef.current) {
        setCompressing(false);
        setCompressProgress(null);
      }
    }
    // 圧縮中に dialog を閉じていたら何もしない (objectURL を破棄してリーク防止)
    if (!mountedRef.current) {
      for (const im of added) URL.revokeObjectURL(im.previewUrl);
      return;
    }
    if (added.length > 0) {
      setImages((prev) => {
        const merged = [...prev, ...added];
        // 上限超過で落ちた分の objectURL を revoke (await を挟む間に prev が増えても漏らさない)
        for (const dropped of merged.slice(MAX_POST_IMAGES)) URL.revokeObjectURL(dropped.previewUrl);
        return merged.slice(0, MAX_POST_IMAGES);
      });
    }
    // スキップ内訳をまとめて 1 つの文言に
    const notes: string[] = [];
    if (overLimit > 0) notes.push(`${overLimit} 枚は上限 (${MAX_POST_IMAGES} 枚) を超えました`);
    if (unsupported > 0) notes.push(`${unsupported} 枚は対応していない形式でした`);
    if (sizeSkipped > 0) {
      // ユーザーには行動 (撮り直し/縮小) を促す。サイズ等の技術詳細は console 側に出す。
      notes.push(`${sizeSkipped} 枚は容量が大きく添付できませんでした。小さくして添付し直してください`);
    }
    setErr(notes.length > 0 ? `一部添付できませんでした: ${notes.join(' / ')}` : null);
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  // 隣の画像と入れ替え (Bluesky は embed.images の配列順で表示するので順序に意味がある)。
  // objectURL は不変なので revoke しない。
  function moveImage(index: number, dir: -1 | 1) {
    setImages((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const a = next[index];
      const b = next[to];
      if (!a || !b) return prev;
      next[index] = b;
      next[to] = a;
      return next;
    });
  }

  async function submit() {
    const body = text.trim();
    if (loading || !agent) return;
    // 画像なしの場合は空文字 NG。画像付きの場合は本文空でも投稿可。
    if (images.length === 0 && !body) return;
    if (body.length > POST_MAX_LENGTH) return;

    setLoading(true);
    setErr(null);
    try {
      if (images.length > 0) {
        // カード共有画像が含まれていれば #AozoraQuest facet を付ける。
        const tag = images.some((im) => im.source === 'card') ? 'AozoraQuest' : undefined;
        await createPostWithImages(agent, body, images.map((im) => ({ blob: im.blob, alt: im.alt })), tag);
      } else {
        const reply: ReplyRef | undefined = replyTo
          ? { root: replyTo.root, parent: replyTo.parent }
          : undefined;
        await createPost(agent, body, reply);
      }
      // via=AozoraQuest で投稿が作成されたので power 累積カウンタを +1。
      // 失敗しても投稿自体は成功してるので UI は閉じる方向で進む。
      const did = session.did;
      if (did) void bumpPower(agent, did, { viaPosts: 1 });
      setText('');
      // 投稿直後に解析 (行動分類 → questLog 更新 → rpgStats 更新) を走らせるが、
      // 推論は数秒〜十数秒かかる (モバイル特に遅い) ので await せずに
      // バックグラウンドで進める。結果は UI 側 (ホーム / /spirit) が
      // useOnPosted で再フェッチするし、LV アップ通知も届いたら表示される。
      if (did && body) {
        // 投稿の構造的特徴 (返信か / 引用か / 自分のスレッドか / 文字数) を post-processor に
        // 渡して、テキスト分類だけでは取れない quote_with_*, thread_continue,
        // calm_debate_reply 等を確定的にカウントできるようにする。
        const isReply = !!replyTo;
        const isReplyToSelf = !!replyTo && replyTo.author === did;
        // 画像添付の card 共有や引用ポストはここでは true 化しない (引用リッチ化は将来対応)。
        const structure = {
          isReply,
          isReplyToSelf,
          isQuote: false,
          textLength: body.length,
        };
        void (async () => {
          try {
            const result = await processSelfPost(agent, did, body, structure);
            if (result.jobLeveledUp && result.jobLevel) {
              notifyLevelUp({
                kind: 'job',
                from: result.jobLeveledUp.from,
                to: result.jobLeveledUp.to,
                jobName: jobDisplayName(result.jobLevel.archetype, 'default'),
              });
            }
            if (result.playerLeveledUp) {
              notifyLevelUp({
                kind: 'player',
                from: result.playerLeveledUp.from,
                to: result.playerLeveledUp.to,
              });
            }
          } catch (e) {
            console.warn('post-processor failed', e);
          }
        })();
      }
      notifyPosted();
      onClose();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
      setLoading(false);
    }
  }

  // 画像添付時のみ「reply 」UI と排他: 既存 reply フローへの画像添付は今回非対応。
  const showImageUi = !replyTo;
  const submitDisabled =
    loading
    || compressing
    || (!text.trim() && images.length === 0)
    || text.length > POST_MAX_LENGTH;

  const isColumn = variant === 'column';
  // 投稿カード本体 (タイトル + フォーム)。モーダルでもカラムでもこれを再利用する。
  const card = (
      <div
        className="dq-window"
        style={{
          width: isColumn ? '100%' : 'min(440px, 100%)',
          margin: 0,
          maxHeight: isColumn ? 'none' : '90vh',
          overflow: isColumn ? 'visible' : 'auto',
        }}
        onClick={isColumn ? undefined : (e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4em' }}>
          <h3 style={{ margin: 0, fontSize: '1em' }}>{replyTo ? '返信' : '投稿する'}</h3>
          <button
            onClick={onClose}
            disabled={loading}
            aria-label="閉じる"
            title="閉じる"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-fg)',
              fontSize: '1.2em',
              padding: '0 0.3em',
              boxShadow: 'none',
            }}
          >
            ✕
          </button>
        </div>

        {replyTo && (
          <div
            style={{
              padding: '0.5em 0.7em',
              borderLeft: '3px solid var(--color-accent)',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 2,
              marginBottom: '0.5em',
              fontSize: '0.85em',
            }}
          >
            <div style={{ color: 'var(--color-muted)', fontSize: '0.8em' }}>@{replyTo.author} への返信</div>
            <div style={{ marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>{replyTo.text}</div>
          </div>
        )}

        <TextField
          multiline
          submitWithModifier
          value={text}
          onChange={setText}
          onSubmit={submit}
          style={{ width: '100%', minHeight: '7em', padding: '0.5em', fontSize: '1em' }}
          placeholder={replyTo ? '返信を書く' : 'いまどうしてる?'}
          maxLength={POST_MAX_LENGTH}
          disabled={loading}
          autoFocus
        />

        {showImageUi && (
          <div style={{ marginTop: '0.5em', display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
            {images.length > 1 && (
              <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: 0 }}>
                上から順に表示されます (1 枚目が代表)。↑ ↓ で並べ替え。
              </p>
            )}
            {/* key は previewUrl (blob ごとに一意・生存中不変)。並べ替えでも安定なので
                index ベース操作でも img/alt の状態が混ざらない reorder-safe key になる。 */}
            {images.map((im, i) => (
              <div
                key={im.previewUrl}
                style={{
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 6,
                  padding: '0.5em',
                  display: 'flex',
                  gap: '0.6em',
                  alignItems: 'flex-start',
                  background: 'rgba(0,0,0,0.25)',
                }}
              >
                <img
                  src={im.previewUrl}
                  alt=""
                  style={{ maxWidth: 120, maxHeight: 160, objectFit: 'contain', borderRadius: 4, background: '#000' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ fontSize: '0.78em', color: 'var(--color-muted)' }}>
                    画像 {i + 1}/{images.length} の代替テキスト (alt)
                  </label>
                  <TextField
                    multiline
                    value={im.alt}
                    onChange={(v) => setImages((prev) => prev.map((p, j) => (j === i ? { ...p, alt: v } : p)))}
                    style={{ width: '100%', minHeight: '3em', padding: '0.3em', fontSize: '0.85em' }}
                    placeholder="画像の説明 (a11y 用、空でも投稿可)"
                    maxLength={1000}
                    disabled={loading}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em', gap: '0.5em', flexWrap: 'wrap' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(im.blob.size / 1024).toFixed(0)} KB · {im.blob.type || '?'}</span>
                    <span style={{ display: 'inline-flex', gap: '0.4em', flexShrink: 0, alignItems: 'center' }}>
                      {images.length > 1 && (
                        <>
                          <button
                            className="secondary"
                            onClick={() => moveImage(i, -1)}
                            disabled={loading || i === 0}
                            aria-label={`画像 ${i + 1} を上へ`}
                            title="上へ"
                            style={IMG_CTRL_BTN}
                          >
                            ↑
                          </button>
                          <button
                            className="secondary"
                            onClick={() => moveImage(i, 1)}
                            disabled={loading || i === images.length - 1}
                            aria-label={`画像 ${i + 1} を下へ`}
                            title="下へ"
                            style={IMG_CTRL_BTN}
                          >
                            ↓
                          </button>
                        </>
                      )}
                      {/* 破壊的アクションなので移動ボタンと間隔を空けて誤タップを防ぐ */}
                      <button
                        className="secondary"
                        onClick={() => removeImage(i)}
                        disabled={loading}
                        aria-label={`画像 ${i + 1} を削除`}
                        style={{ ...IMG_CTRL_BTN, marginLeft: images.length > 1 ? '0.7em' : 0 }}
                      >
                        削除
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {/* 上限到達時もボタンは残し disabled + (N/4) で「これ以上添付できない」を明示 */}
            <div>
              <button
                className="secondary"
                onClick={pickImage}
                disabled={loading || compressing || images.length >= MAX_POST_IMAGES}
                style={{ fontSize: '0.85em' }}
              >
                {compressing
                  ? compressProgress && compressProgress.total > 1
                    ? `画像を準備中... (${compressProgress.done}/${compressProgress.total})`
                    : '画像を準備中...'
                  : images.length === 0
                    ? '画像を添付'
                    : `画像を追加 (${images.length}/${MAX_POST_IMAGES})`}
              </button>
              {compressing && (
                <span style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginLeft: '0.5em' }}>
                  投稿用に画像を準備しています…
                </span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5em' }}>
          <span style={{ fontSize: '0.85em', color: text.length > POST_MAX_LENGTH ? 'var(--color-danger)' : 'var(--color-muted)' }}>
            {text.length} / {POST_MAX_LENGTH}
          </span>
          <div style={{ display: 'flex', gap: '0.4em' }}>
            <button className="secondary" onClick={onClose} disabled={loading}>キャンセル</button>
            <button onClick={submit} disabled={submitDisabled}>
              {loading ? '送信中...' : replyTo ? '返信する' : 'ポスト'}
            </button>
          </div>
        </div>
        {err && <p style={{ color: 'var(--color-danger)', marginTop: '0.5em', fontSize: '0.85em' }}>{err}</p>}
      </div>
  );

  // カラム: ワークスペースの 1 カラムとして常設表示 (overlay なし)
  if (isColumn) {
    return (
      <section className="workspace-column" data-column-kind="compose">
        <div className="workspace-column-body" style={{ padding: '0.6em' }}>{card}</div>
      </section>
    );
  }
  // モーダル: 中央オーバーレイ。背景クリック / ✕ / ESC で閉じる
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.currentTarget === e.target && !loading) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
        zIndex: 100,
      }}
    >
      {card}
    </div>
  );
}

/** PC 左レールの投稿ボタンから開く「投稿カラム」。ワークスペースが描画する。 */
export function ComposeColumn({ onClose }: { onClose: () => void }) {
  return (
    <ComposeDialog
      replyTo={null}
      initialText=""
      initialImage={null}
      onClose={onClose}
      variant="column"
    />
  );
}
