import { useCallback, useEffect, useState } from 'react';
import { useSession } from './session';
import { getPrimaryAdminDid } from './runtime-config';
import { getRecord, putRecord } from './atproto';

/**
 * **主管理者の PDS にある設定レコードを読み書きする** (docs/14-admin §コンフィグ配信)。
 *
 * 元は独立した admin アプリ (`apps/admin`) にあった `useAdminConfig` の移植。
 * あちらは**デプロイ設定が無く `pnpm dev` でしか開けなかった**ので、web の `/admin` に
 * 取り込んだ (オーナー要望 2026-07-27)。書き込み仕様 (`$type` を付ける) は
 * `apps/admin/src/lib/pds.ts` と `scripts/refresh-directory.ts` に揃えること —
 * ずれると毎時の cron と画面が互いの結果を踏み合う。
 */
export interface AdminConfigState<T> {
  loaded: boolean;
  value: T | null;
  saving: boolean;
  err: string | null;
  /** 保存直後の一時マーク (2 秒で消える)。 */
  savedMark: boolean;
  /** **書き込めるか。** web が読む先は主管理者の repo なので、別の管理者でログインしていると
   *  保存しても反映されない = 気づけない失敗になる。先に止めるための旗。 */
  canWrite: boolean;
}

export function useAdminConfig<T>(collection: string, rkey: string) {
  const session = useSession();
  const agent = session.agent ?? null;
  const did = session.did ?? null;
  const adminDid = getPrimaryAdminDid();
  const canWrite = Boolean(did && adminDid && did === adminDid);

  const [state, setState] = useState<Omit<AdminConfigState<T>, 'canWrite'>>({
    loaded: false, value: null, saving: false, err: null, savedMark: false,
  });

  useEffect(() => {
    if (!agent || !did) return;
    let cancelled = false;
    (async () => {
      try {
        const v = await getRecord<T>(agent, did, collection, rkey);
        if (!cancelled) setState((s) => ({ ...s, loaded: true, value: v }));
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loaded: true, err: String((e as Error)?.message ?? e) }));
      }
    })();
    return () => { cancelled = true; };
  }, [agent, did, collection, rkey]);

  const save = useCallback(async (record: object) => {
    if (!agent) throw new Error('not signed in');
    setState((s) => ({ ...s, saving: true, err: null, savedMark: false }));
    try {
      await putRecord(agent, collection, rkey, record);
      setState((s) => ({ ...s, saving: false, savedMark: true, value: record as T }));
      setTimeout(() => setState((s) => ({ ...s, savedMark: false })), 2000);
    } catch (e) {
      setState((s) => ({ ...s, saving: false, err: String((e as Error)?.message ?? e) }));
      throw e;
    }
  }, [agent, collection, rkey]);

  return { ...state, canWrite, save };
}

/** 保存ボタンとその状態表示。5 画面で同じものを書くので共通化する。 */
export interface SaveBarProps {
  saving: boolean;
  savedMark: boolean;
  err: string | null;
  canWrite: boolean;
  onSave: () => void;
  /** 未保存の変更があるか。無ければボタンを落とす。 */
  dirty?: boolean;
}
