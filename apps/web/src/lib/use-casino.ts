/**
 * カジノの窓の状態と操作 (D-CASINO-001)。★のマスに入ったら開く。コインの数は開いたときに権威 state から読む。
 * rkey は操作の種類ごとに 1 つ持ち、通信が切れた (status 0) ときだけ同じ rkey で送り直す (二重に払わない)。
 * レースの顔ぶれは rkey から決まるので、見せた顔ぶれの rkey のまま賭ける。
 */
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Agent } from '@atproto/api';
import type { CasinoGame, CasinoSpot } from '@aozoraquest/core';
import { serverPartyRename, serverState, WorldServerError, type ServerParty } from './world-server';
import type { PartyRenameProps } from '@/components/party-rename';
import { casinoBonus, casinoExchange, casinoPlay, casinoPrize, casinoRace, newCasinoRkey, type CasinoResult } from './casino-server';
import type { CasinoActions, HighLowHand } from '@/components/casino-modal';

export function useCasino({ agent, tokenRef, setServerPower, applyServerMaterials, onPieces }: {
  agent: Agent | null;
  tokenRef: MutableRefObject<string | undefined>;
  setServerPower: (power: number) => void;
  applyServerMaterials: (m: Record<string, number>) => void;
  onPieces: (pieces: NonNullable<CasinoResult['pieces']>) => void;
}) {
  const [spot, setSpot] = useState<CasinoSpot | null>(null);
  const [coins, setCoins] = useState(0);
  /** 開いたときに権威 state に残っていたハイローの手 (閉じたり読み直したりしても続きから遊べるように)。 */
  const [pendingHighLow, setPendingHighLow] = useState<HighLowHand | null>(null);
  const pending = useRef(new Map<string, string>());
  const raceRkey = useRef(newCasinoRkey());

  const open = useCallback((s: CasinoSpot) => {
    setSpot(s);
    setPendingHighLow(null);
    if (agent) void serverState(agent).then((r) => { setCoins(r.state.casinoCoins ?? 0); setPendingHighLow(r.state.casinoHL ?? null); }, () => {});
  }, [agent]);

  const send = useCallback(async (kind: string, call: (rkey: string) => Promise<CasinoResult>, rkey?: string): Promise<CasinoResult> => {
    if (!agent) throw new Error('サーバーに接続できない');
    const key = rkey ?? pending.current.get(kind) ?? newCasinoRkey();
    pending.current.set(kind, key);
    try {
      const r = await call(key);
      pending.current.delete(kind);
      setCoins(r.coins);
      if (typeof r.power === 'number') setServerPower(r.power);
      if (r.materials) applyServerMaterials(r.materials);
      if (r.pieces) onPieces(r.pieces);
      return r;
    } catch (e) {
      // 通信が切れたときだけ同じ rkey を残す (サーバーが断ったときは次は新しい操作)。
      if (!(e instanceof WorldServerError && e.status === 0)) pending.current.delete(kind);
      throw e;
    }
  }, [agent, setServerPower, applyServerMaterials, onPieces]);

  const actions: CasinoActions = useMemo(() => ({
    exchange: (power) => send(`exchange:${power}`, (k) => casinoExchange(agent!, power, k, tokenRef.current)),
    bonus: () => send('bonus', (k) => casinoBonus(agent!, k, tokenRef.current)),
    prize: (id) => send(`prize:${id}`, (k) => casinoPrize(agent!, id, k, tokenRef.current)),
    play: async (game: CasinoGame, body) => {
      if (game !== 'race') return send(`play:${game}`, (k) => casinoPlay(agent!, { game, ...body }, k, tokenRef.current));
      const r = await send('play:race', (k) => casinoPlay(agent!, { game, ...body }, k, tokenRef.current), raceRkey.current);
      raceRkey.current = newCasinoRkey();
      return r;
    },
    raceLineup: async () => {
      if (!agent) throw new Error('サーバーに接続できない');
      return (await casinoRace(agent, raceRkey.current, tokenRef.current)).runners;
    },
  }), [agent, send, tokenRef]);

  /** パーティの画面の なまえのふだ。同じ仲間への送り直しは同じ rkey (通信が切れたときだけ)。 */
  const renameProps = useCallback((materials: Record<string, number>, setParty: (p: ServerParty) => void): PartyRenameProps => ({
    tags: materials['name-tag'] ?? 0,
    save: async (id, name) => {
      if (!agent) throw new Error('サーバーに接続できない');
      const kind = `rename:${id}:${name}`;
      const key = pending.current.get(kind) ?? newCasinoRkey();
      pending.current.set(kind, key);
      try {
        const res = await serverPartyRename(agent, id, name, key);
        pending.current.delete(kind);
        setParty(res.party);
        applyServerMaterials(res.materials);
      } catch (e) {
        if (!(e instanceof WorldServerError && e.status === 0)) pending.current.delete(kind);
        throw e;
      }
    },
  }), [agent, applyServerMaterials]);

  return { casinoSpot: spot, casinoCoins: coins, casinoPendingHighLow: pendingHighLow, openCasino: open, closeCasino: useCallback(() => setSpot(null), []), casinoActions: actions, renameProps };
}
