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
  /** **読み込みに失敗した**。`loaded` は「読み終えた (失敗含む)」なので、これと分けて持つ。
   *  レコードが無い (value=null) のは正常だが、読めなかったのは異常 — 空の state のまま
   *  保存すると既存の設定を全消しする。 */
  loadFailed: boolean;
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
    loaded: false, value: null, loadFailed: false, saving: false, err: null, savedMark: false,
  });

  useEffect(() => {
    if (!agent || !did) return;
    let cancelled = false;
    (async () => {
      try {
        // **読むのは主管理者の repo**。web 本体 (runtime-config) が読む先と揃えないと、
        // 副管理者でログインしたときに自分の空 repo を見て「0 人」と表示し、
        // それが本番設定だと誤読させる。
        const v = await getRecord<T>(agent, adminDid ?? did, collection, rkey);
        if (!cancelled) setState((s) => ({ ...s, loaded: true, loadFailed: false, value: v }));
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loaded: true, loadFailed: true, err: String((e as Error)?.message ?? e) }));
      }
    })();
    return () => { cancelled = true; };
  }, [agent, did, adminDid, collection, rkey]);

  /** 最新値を読み直して返す (保存直前の突き合わせ用)。state も更新する。 */
  const reload = useCallback(async (): Promise<T | null> => {
    if (!agent) return null;
    const v = await getRecord<T>(agent, adminDid ?? did ?? '', collection, rkey);
    setState((s) => ({ ...s, value: v, loaded: true, loadFailed: false }));
    return v;
  }, [agent, adminDid, did, collection, rkey]);

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

  return { ...state, canWrite, save, reload };
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
