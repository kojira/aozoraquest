import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import type { InteriorMap } from '@aozoraquest/core';
import type { DialogueChoice, DialogueLine } from '@/lib/dialogue';
import { serverInnRest, serverShrinePray, WorldServerError, type ServerInnRestResult, type ServerParty } from '@/lib/world-server';
import { hereName, sceneDialogue } from '@/lib/scene-dialogue';
import type { Vitals } from '@/lib/world-view';
import { soundPlayer } from '@/lib/sound/sound-player';

/** 宿屋・ほこら の会話の段 (#766・D-REVIVE-001)。ask の段だけ はい/いいえ を出す。 */
export interface InnTalk { lines: DialogueLine[]; ask?: { price: number; shrine?: boolean } }

const newRkey = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 宿の人の一言: 倒れた仲間は宿では起きないので、ほこら を教える (D-REVIVE-001)。 */
export function innDownedLine(who: string, downed: ServerInnRestResult['downed']): DialogueLine[] {
  if (!downed?.count) return [];
  const where = downed.shrineTown ? `「${downed.shrineTown}」の ほこら` : 'ほこら';
  return [{ speaker: who, text: `たおれた おなかまは、ここで ねても めを さましません。${where}で おいのりを してもらいなさい。` }];
}

/**
 * 宿屋の扉に入ったら開く会話 (#766)。扉に入るだけでは泊まらず、「はい」のときだけ
 * `/api/inn/rest` を呼ぶ。満タンか・残高が足りるかは edge が決める (client で先に止めない)。
 */
export function useInnTalk({ agent, moveBusyRef, tokenRef, wsRef, setWs, setServerPower, scheduleSave, waitForFreshDirectionRef, setParty }: {
  agent: Agent | null;
  moveBusyRef: MutableRefObject<boolean>;
  tokenRef: MutableRefObject<string | undefined>;
  wsRef: MutableRefObject<Vitals | null>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  scheduleSave: () => void;
  waitForFreshDirectionRef: MutableRefObject<boolean>;
  /** ほこらで起きた仲間を world の party に (D-REVIVE-001)。 */
  setParty?: (p: ServerParty) => void;
}) {
  const [innTalk, setInnTalkState] = useState<InnTalk | null>(null);
  // 入力ガードは state の再描画を待たずに読む (選んだ直後の onDone もこれで比べる)。
  const innTalkRef = useRef<InnTalk | null>(null);
  const setInnTalk = useCallback((next: InnTalk | null) => { innTalkRef.current = next; setInnTalkState(next); }, []);
  const [innBusy, setInnBusy] = useState(false);
  const whoRef = useRef('やどや');

  const openInn = useCallback((inn: NonNullable<InteriorMap['inn']>) => {
    const who = inn.name ?? 'やどや';
    // 文は会話データ (D-DIALOGUE-006)。inn.ask が無ければ宿の会話を開かない (設定漏れの環境だけ)。
    const lines = sceneDialogue('inn.ask', { vars: { price: inn.price }, here: hereName(who) });
    if (lines.length === 0) return;
    whoRef.current = who;
    setInnTalk({ lines, ask: { price: inn.price } });
  }, [setInnTalk]);

  /** ほこらのマスに立ったら、おそなえ をして いのるか聞く (D-REVIVE-001)。 */
  const openShrine = useCallback((shrine: { price: number; name?: string }) => {
    const who = shrine.name ?? 'ほこらの まもりびと';
    whoRef.current = who;
    setInnTalk({ lines: [{ speaker: who, text: `たおれた おなかまを、かみさまに おこしてもらいましょうか。おそなえは ${shrine.price} パワーです。` }], ask: { price: shrine.price, shrine: true } });
  }, [setInnTalk]);

  const pray = async () => {
    if (!agent || moveBusyRef.current) return;
    const who = whoRef.current;
    moveBusyRef.current = true;
    setInnBusy(true);
    try {
      const res = await serverShrinePray(agent, newRkey(), tokenRef.current);
      setServerPower(res.power);
      if (res.party && setParty) setParty(res.party);
      if (res.denied) setInnTalk({ lines: [{ speaker: who, text: `おそなえは ${res.denied.price} パワーです。…パワーが たりない (今${res.power})。` }] });
      else if (res.revived.length === 0) setInnTalk({ lines: [{ speaker: who, text: 'いまは たおれている おなかまは いないようですね。' }] });
      else {
        soundPlayer.playJingle('inn');
        setInnTalk({ lines: [{ text: `おそなえを した (パワー -${res.paid})。${res.revived.map((r) => `${r.name}が いきかえった! (HP ${r.hp})`).join(' ')}` }] });
      }
    } catch (e) {
      setInnTalk({ lines: [{ text: e instanceof WorldServerError ? e.message : '通信に失敗した…' }] });
    } finally {
      moveBusyRef.current = false;
      setInnBusy(false);
    }
  };

  const rest = async () => {
    if (!agent || moveBusyRef.current) return;
    const who = whoRef.current;
    moveBusyRef.current = true;
    setInnBusy(true);
    try {
      const res = await serverInnRest(agent, tokenRef.current);
      if (res.inn) {
        setServerPower(res.inn.power);
        if (res.inn.paid > 0) {
          soundPlayer.playJingle('inn');
          const cur = wsRef.current;
          if (cur) {
            const next = { ...cur, hp: null, mp: null };
            wsRef.current = next;
            setWs(next);
            scheduleSave();
          }
          setInnTalk({ lines: [
            { text: `${who}に泊まった (パワー -${res.inn.paid})。${res.downed?.count ? '' : 'すっかり元気になった!'}` },
            ...sceneDialogue('inn.thanks', { here: hereName(who) }),
            ...innDownedLine(who, res.downed),
          ] });
        } else setInnTalk({ lines: [{ text: `「${who}」…今はよく眠れているようだ。` }, ...innDownedLine(who, res.downed)] });
      } else if (res.innDenied) {
        setServerPower(res.innDenied.power);
        setInnTalk({ lines: [{ text: `${who}「一晩${res.innDenied.price}パワーだよ」…パワーが足りない (今${res.innDenied.power})。` }, ...innDownedLine(who, res.downed)] });
      }
    } catch (e) {
      setInnTalk({ lines: [{ text: e instanceof WorldServerError ? e.message : '通信に失敗した…' }] });
    } finally {
      moveBusyRef.current = false;
      setInnBusy(false);
    }
  };

  const innChoices: DialogueChoice[] | undefined = innTalk?.ask ? [
    { label: 'はい', onSelect: innTalk.ask.shrine ? pray : rest },
    { label: 'いいえ', onSelect: () => {
      if (innTalk.ask?.shrine) { waitForFreshDirectionRef.current = true; setInnTalk(null); return; }
      // inn.decline が無ければ窓を出さずに閉じる。
      const lines = sceneDialogue('inn.decline', { here: hereName(whoRef.current) });
      if (lines.length) setInnTalk({ lines });
      else { waitForFreshDirectionRef.current = true; setInnTalk(null); }
    } },
  ] : undefined;

  /** 段を読み終えた。選択肢が次の段へ進めていれば閉じない。閉じたら押しっぱなしの方向キーで扉を往復しない。 */
  const innDone = (step: InnTalk) => {
    if (innTalkRef.current !== step) return;
    waitForFreshDirectionRef.current = true;
    setInnTalk(null);
  };

  return { innTalk, innTalkRef, innBusy, innChoices, openInn, openShrine, innDone };
}
