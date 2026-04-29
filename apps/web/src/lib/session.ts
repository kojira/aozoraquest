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
    // 何らかの理由 (concurrent refresh の race / 手動 IDB 削除 等) で
    // SessionStore から session が消えた瞬間に signed-out へ flip する。
    // boot 時の warmup 経路でも runtime の cascade 経路でもここを通る。
    const unsubscribe = onSessionDeleted(() => {
      if (cancelled) return;
      setState({ status: 'signed-out' });
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
  try {
    await agent.com.atproto.server.getSession();
  } catch (e) {
    console.warn('[session] warmup failed; signing out', e);
    if (!isCancelled()) setState({ status: 'signed-out' });
    return;
  }
  if (isCancelled()) return;

  const next: SessionState = { status: 'signed-in', did, agent };
  // 公開 AppView から引く: PDS 経由の getProfile は初期化直後に 401 が出ることがある
  try {
    const publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });
    const profile = await publicAgent.getProfile({ actor: did });
    if (profile.data.handle) next.handle = profile.data.handle;
  } catch (e) {
    console.warn('getProfile failed', e);
  }
  if (!isCancelled()) setState(next);
}
