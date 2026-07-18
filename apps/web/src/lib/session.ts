import { Agent, AtpAgent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { createContext, useContext, useEffect, useState } from 'react';
import { onSessionDeleted, restoreSession } from './oauth';

/**
 * 公開 AppView エンドポイント。OAuth セッションの PDS は app.bsky.* を
 * プロキシするはずだが、一部のケース (session 復元直後など) で 401 を返す。
 * 名前解決のような公開読み取りはこちらから引く。
 */
const PUBLIC_APPVIEW = 'https://api.bsky.app';

/** warmup (getSession) の上限。復元は本来 <1s なので、これを超えたら「ハングした古い/壊れた
 *  セッション」とみなし signed-out へ倒す (遅いだけの valid セッションを誤って切らない余裕を持たせる)。 */
const WARMUP_TIMEOUT_MS = 10_000;

/** `promise` を `ms` でタイムアウトさせる。超えたら `Error('<label>-timeout')` で reject。
 *  勝敗どちらでもタイマーを片付ける (保留タイマー/unhandled rejection を残さない)。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'op'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}-timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface SessionState {
  status: 'loading' | 'signed-in' | 'signed-out';
  did?: string;
  handle?: string;
  agent?: Agent;
}

export const SessionContext = createContext<SessionState>({ status: 'loading' });

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function useSessionLoader(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // 何らかの理由 (concurrent refresh の race / 手動 IDB 削除 / 別タブからの
    // cross-tab broadcast 等) で SessionStore から session が消えた瞬間に
    // signed-out へ flip する。
    //
    // ただし以下の場合は flip しない:
    // 1. 既に signed-out (= 別タブの broadcast を受けただけで自分は無関係) →
    //    無駄な re-render を避ける
    // 2. 削除された sub が自分の did と一致しない (= 別タブ・別アカウントの
    //    削除 broadcast) → 自分のセッションは生きているので維持
    const unsubscribe = onSessionDeleted((deletedSub, cause) => {
      if (cancelled) return;
      setState((curr) => {
        if (curr.status !== 'signed-in') return curr; // 1.
        if (curr.did && deletedSub && curr.did !== deletedSub) return curr; // 2.
        // 自分の現セッションが消されたケース。ここで初めて log を出す
        // (oauth.ts は cross-tab broadcast も含めて全 onDelete を捉えるが、
        // signed-out に倒す決定はこの listener 内で sub マッチを見て出すため、
        // 観測すべきイベントもこのタイミングで出す)。
        const causes: unknown[] = [];
        let cur: unknown = (cause as { cause?: unknown })?.cause;
        for (let i = 0; i < 5 && cur; i++) {
          causes.push(cur);
          cur = (cur as { cause?: unknown })?.cause;
        }
        console.error('[session] my session was deleted; signing out', {
          sub: deletedSub,
          cause,
          name: (cause as Error)?.name,
          message: (cause as Error)?.message,
          stack: (cause as Error)?.stack,
          causes,
          timestamp: new Date().toISOString(),
        });
        return { status: 'signed-out' };
      });
    });
    (async () => {
      try {
        const session = await restoreSession();
        if (cancelled) return;
        if (!session) {
          setState({ status: 'signed-out' });
          return;
        }
        await setStateFromSession(session, setState, () => cancelled);
      } catch (err) {
        console.error('session restore failed', err);
        if (!cancelled) setState({ status: 'signed-out' });
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return state;
}

async function setStateFromSession(
  session: OAuthSession,
  setState: (s: SessionState) => void,
  isCancelled: () => boolean,
): Promise<void> {
  // 計測: 復元したセッションの shape (寿命含む) を出して、後続の onDelete と
  // 突き合わせやすくする。token 本体は出さない。
  // OAuthSession は内部 tokenSet を直接公開しないので tokenSet は省略。
  console.info('[session] restored', {
    did: session.did,
    timestamp: new Date().toISOString(),
  });

  const agent = new Agent(session);
  const did = session.did;

  // ★ warmup barrier: agent を React 配下に expose する前に 1 本だけ
  //   xrpc を直列に走らせ、必要なら token refresh を孤立した状態で
  //   完了させる。これで signed-in 直後に発射される 10+ 並行呼び出しは
  //   全部 fresh token を SessionStore から読むだけで race が原理的に発生
  //   しなくなる。失敗したら signed-out に倒し、下流の useEffect が
  //   agent を一切触らないようにする。
  //   ★ タイムアウト: 古い/壊れたセッションで getSession が**ハング**すると無限スプラッシュに
  //   なる (復元は本来 <1s)。一定時間で打ち切って signed-out に倒し、ログイン画面から復帰できる
  //   ようにする (失敗と同じ扱い。valid だが遅いだけのセッションを誤って切らないよう余裕を持たせる)。
  try {
    await withTimeout(agent.com.atproto.server.getSession(), WARMUP_TIMEOUT_MS, 'warmup');
  } catch (e) {
    // 失敗 or タイムアウト → signed-out (= ログイン画面) に倒す。無限スプラッシュにしない。
    console.warn('[session] warmup failed/timed out; signing out', e);
    if (!isCancelled()) setState({ status: 'signed-out' });
    return;
  }
  if (isCancelled()) return;

  // ハンドル取得 (getProfile) は**表示に必須でない**ので待たない。先に signed-in にして
  // workspace を描画させ (= 「準備しています」を早く抜けフィード/キャッシュを出す)、handle は
  // バックグラウンドで取得して来たら足す。これで初回表示のブロッキングから 1 往復ぶん外れる。
  const next: SessionState = { status: 'signed-in', did, agent };
  if (!isCancelled()) setState(next);

  void (async () => {
    try {
      // 公開 AppView から引く: PDS 経由の getProfile は初期化直後に 401 が出ることがある
      const publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });
      const profile = await publicAgent.getProfile({ actor: did });
      if (!isCancelled() && profile.data.handle) {
        // agent は同一 instance のまま handle だけ足して更新 (下流の再 fetch は起きない)。
        setState({ ...next, handle: profile.data.handle });
      }
    } catch (e) {
      console.warn('getProfile failed', e);
    }
  })();
}
