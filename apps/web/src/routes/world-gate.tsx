import { Link } from 'react-router-dom';
import { isBanned } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { useRuntimeConfigState } from '@/components/config-provider';
import { World } from './world';

/**
 * **BAN 済み DID にはワールドを描かない** (#561)。`/world` はこれを経由して `World` に入る。
 *
 * BAN が効くのは**あおぞらワールドだけ** — 投稿・タイムライン・バッジ・依頼クエスト板には
 * 効かせない (Bluesky の公開データで、こちらで除外しても他のクライアントからは見えるので
 * 意味が薄い)。ワールドは権威 state をこちらが持っているので止める意味がある。本当の門は
 * edge の 403 で、ここは「入れないのに歩けそうに見える」画面を出さないための表示ゲート。
 *
 * `World` は mount した瞬間から権威 API を叩くので、**設定を読み終えるまで mount しない**
 * (既定値 = BAN 無しで先に描くと、BAN 済みの人にも一瞬ゲームが見えて 403 が並ぶ)。
 * 判定関数 (`isBanned`) は core のもの — edge と同じ。
 */
export function WorldGate() {
  const session = useSession();
  const { config, loaded } = useRuntimeConfigState();
  if (!loaded) return <p>読み込み中…</p>;
  if (session.status === 'signed-in' && isBanned(config.bans, session.did)) {
    return (
      <div>
        <h2>あおぞらワールド</h2>
        <p role="status">このアカウントではワールドは利用できません。</p>
        <Link to="/">← ホームへ</Link>
      </div>
    );
  }
  return <World />;
}
