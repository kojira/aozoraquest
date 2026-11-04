import { useMemo, useState } from 'react';
import { partyDefsOf, recruitById, type Archetype, type EquipSlot, type GearSelection } from '@aozoraquest/core';
import { GearModal } from './gear-modal';
import { equipWithHands } from '@/lib/use-world-shop';
import { refsOfSelection, selectionOfRefs, wornByOthers, type GearWearer } from '@/lib/gear-who';
import type { CraftedPiece } from '@/lib/crafting';
import type { GearRefs } from '@/lib/gear';
import type { ServerParty } from '@/lib/world-server';

/**
 * メニュー「そうび」(D-PARTY-004 §6)。上に「だれの？」(主人公＋仲間) の切りかえ。中身は今の GearModal を使い回し、
 * ほかの人が着ている品は「ミオが そうび中」と出して選べなくする。仲間がいなければ今と同じ。
 * 主人公の着脱は今までどおり (gear/self の rkey 参照)。仲間は {id, level} をサーバーへ送る (POST /api/party/gear)。
 */
export function PartyGearModal({ archetype, heroName, pieces, refs, party, jobLevel, busy, errorText, onEquip, onUnequip, onDiscard, saveAllyGear, onClose }: {
  archetype: Archetype | null;
  heroName: string;
  pieces: CraftedPiece[];
  refs: GearRefs;
  party: ServerParty;
  jobLevel: number;
  busy?: boolean;
  errorText?: string | null;
  onEquip: (slot: EquipSlot, rkey: string) => void;
  onUnequip: (slot: EquipSlot) => void;
  onDiscard: (rkey: string) => void;
  /** 仲間の装備を送る (応答の party で world を更新する)。失敗は理由の文を投げる。 */
  saveAllyGear: (id: string, gear: GearSelection) => Promise<void>;
  onClose: () => void;
}) {
  const [who, setWho] = useState('hero');
  const [allyErr, setAllyErr] = useState<string | null>(null);
  const [allyBusy, setAllyBusy] = useState(false);
  const allies = useMemo(() => partyDefsOf(party, recruitById, jobLevel), [party, jobLevel]);
  const ally = allies.find((a) => a.id === who);
  const heroSel = useMemo(() => selectionOfRefs(refs, pieces), [refs, pieces]);
  const wearers: GearWearer[] = useMemo(() => [{ who: 'hero', name: heroName, gear: heroSel }, ...allies.map((a) => ({ who: a.id, name: a.name, gear: party.gear?.[a.id] ?? {} }))], [heroName, heroSel, allies, party.gear]);
  // いま見ている人の装備 (rkey 参照)。仲間は主人公の着ている個体を避けて割り当てる。
  const heroRkeys = useMemo(() => new Set(Object.values(refs).filter((v): v is string => !!v)), [refs]);
  const myRefs = ally ? refsOfSelection(party.gear?.[ally.id] ?? {}, pieces, heroRkeys) : refs;
  const wornBy = useMemo(() => wornByOthers(pieces, myRefs, wearers.filter((w) => w.who !== (ally?.id ?? 'hero'))), [pieces, myRefs, wearers, ally]);

  const send = async (next: GearRefs) => {
    if (!ally) return;
    setAllyBusy(true);
    setAllyErr(null);
    try {
      await saveAllyGear(ally.id, selectionOfRefs(next, pieces));
    } catch (e) {
      setAllyErr(e instanceof Error && e.message ? e.message : 'そうびできなかった (通信エラー)。');
    } finally {
      setAllyBusy(false);
    }
  };
  const whose = allies.length ? { options: wearers.map((w) => ({ who: w.who, name: w.name })), current: ally?.id ?? 'hero', onChange: (w: string) => { setAllyErr(null); setWho(w); } } : undefined;

  return (
    <GearModal
      archetype={ally ? ally.archetype : archetype}
      pieces={pieces}
      refs={myRefs}
      busy={!!busy || allyBusy}
      errorText={ally ? allyErr : errorText ?? null}
      onDiscard={onDiscard}
      onEquip={ally ? (slot, rkey) => void send(equipWithHands(myRefs, slot, rkey, pieces)) : onEquip}
      onUnequip={ally ? (slot) => { const next = { ...myRefs }; delete next[slot]; void send(next); } : onUnequip}
      onClose={onClose}
      whose={whose}
      wornBy={wornBy}
    />
  );
}
