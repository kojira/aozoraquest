import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import type { InteriorMap } from '@aozoraquest/core';
import type { DialogueChoice, DialogueLine } from '@/lib/dialogue';
import { serverInnRest, WorldServerError } from '@/lib/world-server';
import type { Vitals } from '@/lib/world-view';

/** 宿屋の会話の段 (#766)。ask の段だけ はい/いいえ を出す。 */
export interface InnTalk { lines: DialogueLine[]; ask?: { price: number } }

/**
 * 宿屋の扉に入ったら開く会話 (#766)。扉に入るだけでは泊まらず、「はい」のときだけ
 * `/api/inn/rest` を呼ぶ。満タンか・残高が足りるかは edge が決める (client で先に止めない)。
 */
export function useInnTalk({ agent, moveBusyRef, tokenRef, wsRef, setWs, setServerPower, scheduleSave, waitForFreshDirectionRef }: {
  agent: Agent | null;
  moveBusyRef: MutableRefObject<boolean>;
  tokenRef: MutableRefObject<string | undefined>;
  wsRef: MutableRefObject<Vitals | null>;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setServerPower: Dispatch<SetStateAction<number | null>>;
  scheduleSave: () => void;
  waitForFreshDirectionRef: MutableRefObject<boolean>;
}) {
  const [innTalk, setInnTalkState] = useState<InnTalk | null>(null);
  // 入力ガードは state の再描画を待たずに読む (選んだ直後の onDone もこれで比べる)。
  const innTalkRef = useRef<InnTalk | null>(null);
  const setInnTalk = useCallback((next: InnTalk | null) => { innTalkRef.current = next; setInnTalkState(next); }, []);
  const [innBusy, setInnBusy] = useState(false);
  const whoRef = useRef('やどや');

  const openInn = useCallback((inn: NonNullable<InteriorMap['inn']>) => {
    const who = inn.name ?? 'やどや';
    whoRef.current = who;
    setInnTalk({ lines: [{ speaker: who, text: `一晩${inn.price}パワーです。泊まっていきますか？` }], ask: { price: inn.price } });
  }, [setInnTalk]);

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
          const cur = wsRef.current;
          if (cur) {
            const next = { ...cur, hp: null, mp: null };
            wsRef.current = next;
            setWs(next);
            scheduleSave();
          }
          setInnTalk({ lines: [
            { text: `${who}に泊まった (パワー -${res.inn.paid})。すっかり元気になった!` },
            { speaker: who, text: 'ゆっくり休めたかい？　またどうぞ。' },
          ] });
        } else setInnTalk({ lines: [{ text: `「${who}」…今はよく眠れているようだ。` }] });
      } else if (res.innDenied) {
        setServerPower(res.innDenied.power);
        setInnTalk({ lines: [{ text: `${who}「一晩${res.innDenied.price}パワーだよ」…パワーが足りない (今${res.innDenied.power})。` }] });
      }
    } catch (e) {
      setInnTalk({ lines: [{ text: e instanceof WorldServerError ? e.message : '通信に失敗した…' }] });
    } finally {
      moveBusyRef.current = false;
      setInnBusy(false);
    }
  };

  const innChoices: DialogueChoice[] | undefined = innTalk?.ask ? [
    { label: 'はい', onSelect: rest },
    { label: 'いいえ', onSelect: () => setInnTalk({ lines: [{ speaker: whoRef.current, text: 'またどうぞ。' }] }) },
  ] : undefined;

  /** 段を読み終えた。選択肢が次の段へ進めていれば閉じない。閉じたら押しっぱなしの方向キーで扉を往復しない。 */
  const innDone = (step: InnTalk) => {
    if (innTalkRef.current !== step) return;
    waitForFreshDirectionRef.current = true;
    setInnTalk(null);
  };

  return { innTalk, innTalkRef, innBusy, innChoices, openInn, innDone };
}
