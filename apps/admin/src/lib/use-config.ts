import { useCallback, useEffect, useState } from 'react';
import { useAdminSession } from './session';
import { getConfigRecord, putConfigRecord } from './pds';

export interface ConfigHookState<T> {
  loaded: boolean;
  value: T | null;
  saving: boolean;
  err: string | null;
  savedMark: boolean;
}

/**
 * admin 自身の PDS にある (collection, rkey) をロード/保存するフック。
 * value は自分で useState したいケースもあるので、ここでは value の参照 + save 関数を返すだけ。
 */
export function useAdminConfig<T>(collection: string, rkey: string) {
  const session = useAdminSession();
  const [state, setState] = useState<ConfigHookState<T>>({
    loaded: false,
    value: null,
    saving: false,
    err: null,
    savedMark: false,
  });

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;
    (async () => {
      try {
        const v = await getConfigRecord<T>(agent, collection, rkey);
        setState((s) => ({ ...s, loaded: true, value: v }));
      } catch (e) {
        setState((s) => ({ ...s, loaded: true, err: String((e as Error)?.message ?? e) }));
      }
    })();
  }, [session.status, session.agent, collection, rkey]);

  const save = useCallback(async (record: object) => {
    if (session.status !== 'signed-in' || !session.agent) throw new Error('not signed in');
    setState((s) => ({ ...s, saving: true, err: null, savedMark: false }));
    try {
      await putConfigRecord(session.agent, collection, rkey, record);
      setState((s) => ({ ...s, saving: false, savedMark: true, value: record as T }));
      setTimeout(() => setState((s) => ({ ...s, savedMark: false })), 2000);
    } catch (e) {
      setState((s) => ({ ...s, saving: false, err: String((e as Error)?.message ?? e) }));
      throw e;
    }
  }, [session.agent, session.status, collection, rkey]);

  return { ...state, save };
}
