import { Agent, AtpAgent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { createContext, useContext, useEffect, useState } from 'react';
import { restoreSession } from './oauth';

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
    (async () => {
      try {
        const session = await restoreSession();
        if (cancelled) return;
        if (!session) {
          setState({ status: 'signed-out' });
          return;
        }
        await setStateFromSession(session, setState);
      } catch (err) {
        console.error('session restore failed', err);
        setState({ status: 'signed-out' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

async function setStateFromSession(
  session: OAuthSession,
  setState: (s: SessionState) => void,
): Promise<void> {
  const agent = new Agent(session);
  const did = session.did;
  const next: SessionState = { status: 'signed-in', did, agent };
  // 公開 AppView から引く: PDS 経由の getProfile は初期化直後に 401 が出ることがある
  try {
    const publicAgent = new AtpAgent({ service: PUBLIC_APPVIEW });
    const profile = await publicAgent.getProfile({ actor: did });
    if (profile.data.handle) next.handle = profile.data.handle;
  } catch (e) {
    console.warn('getProfile failed', e);
  }
  setState(next);
}
