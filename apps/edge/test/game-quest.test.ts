/**
 * ゲーム内クエスト (#423) の受注・達成 (edge 権威)。
 *
 * 守るべき不変条件:
 *   - 討伐数は勝利の権威経路 (applyBattleOutcome) だけが増やす
 *   - collect は権威在庫を検証し、達成時に**引き取る** (引かないと同素材で何度も達成できる)
 *   - 達成済みは再受注・再達成できない (二重報酬防止)
 *   - 報酬パワーは定義の値だけ。上限 MAX_QUEST_REWARD_POWER で clamp
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { MONSTERS, setGameQuests, setNpcs, type GameQuestDef } from '@aozoraquest/core';
import { handleQuestAccept, handleQuestComplete, GameQuestError } from '../src/game-quest';
import { applyBattleOutcome } from '../src/battle-reward';
import { rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:alice';
const SERVER_DID = 'did:plc:testserver';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
async function makeEnv(): Promise<GameStateEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
function statefulPds(seed?: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>();
  if (seed) store.set(rkeyForDid(DID), { value: seed, cid: 'c0' });
  let counter = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('com.atproto.repo.getRecord')) {
      const rkey = new URL(url).searchParams.get('rkey')!;
      const rec = store.get(rkey);
      return rec ? json(200, { uri: `at://${rkey}`, cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('com.atproto.repo.putRecord')) {
      const b = JSON.parse(init.body as string) as { rkey: string; record: unknown; swapRecord?: string | null };
      const cur = store.get(b.rkey);
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.set(b.rkey, { value: b.record, cid: `cid${++counter}` });
      return json(200, { uri: `at://${b.rkey}`, cid: `cid${counter}` });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store };
}
const stored = (store: Map<string, { value: unknown; cid: string }>) => store.get(rkeyForDid(DID))!.value as GameState;

const MON = MONSTERS.find((m) => m.tier === 1)!;

const stateAt = (over: Partial<GameState> = {}): GameState => ({
  did: DID, power: 10, playerXp: 0, jobXp: {},
  materials: { herb: 5 },
  gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over,
});

const DEFEAT_Q: GameQuestDef = {
  id: 'q-defeat', title: 'スライム たいじ', npcId: 'npc-t1',
  intro: ['たのむ!'], done: ['ありがとう!'],
  objective: { kind: 'defeat', monsterId: MON.id, count: 2 },
  reward: { power: 7 },
};
const COLLECT_Q: GameQuestDef = {
  id: 'q-collect', title: 'やくそう あつめ', npcId: 'npc-t2',
  intro: ['やくそうを 3つ たのむ'], done: ['たすかった!'],
  objective: { kind: 'collect', itemId: 'herb', count: 3 },
  reward: { power: 5, itemId: 'sky-feather', count: 1 },
};

beforeAll(() => {
  setNpcs([
    { id: 'npc-t1', name: 'そんちょう', x: 5, y: 5, lines: ['こんにちは'] },
    { id: 'npc-t2', name: 'くすしや', x: 6, y: 5, lines: ['こんにちは'] },
  ]);
  setGameQuests([DEFEAT_Q, COLLECT_Q]);
});

describe('handleQuestAccept', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('受注で quest が積まれる (progress 0)', async () => {
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.quest).toEqual({ id: 'q-defeat', progress: 0 });
    expect(stored(m.store).quest).toEqual({ id: 'q-defeat', progress: 0 });
  });

  it('未知のクエストは 404', async () => {
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestAccept(await makeEnv(), DID, 'nope', NOW)).rejects.toThrow(GameQuestError);
  });

  it('別クエスト進行中は受けられない (1 つずつ)', async () => {
    globalThis.fetch = statefulPds(stateAt({ quest: { id: 'q-collect', progress: 0 } })).fn;
    await expect(handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'quest_busy' });
  });

  it('同じクエストの再受注は no-op (連打・再送で壊れない)', async () => {
    const m = statefulPds(stateAt({ quest: { id: 'q-defeat', progress: 1 } }));
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.quest).toEqual({ id: 'q-defeat', progress: 1 }); // progress を巻き戻さない
  });

  it('定義が消された孤児クエストを抱えていても、新しいクエストを受けられる', async () => {
    // 管理者がエディタで削除した後もプレイヤーの GameState には残る。破棄手段が無いので、
    // 受注時に孤児を落とさないと永久に何も受けられない。
    const m = statefulPds(stateAt({ quest: { id: 'q-deleted', progress: 3 } }));
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.quest).toEqual({ id: 'q-defeat', progress: 0 });
    expect(stored(m.store).quest).toEqual({ id: 'q-defeat', progress: 0 });
  });

  it('達成済みは再受注できない', async () => {
    globalThis.fetch = statefulPds(stateAt({ questsDone: ['q-defeat'] })).fn;
    await expect(handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'already_done' });
  });
});

describe('handleQuestComplete (defeat)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('討伐数が足りないと not_ready (サーバーが進行を検証)', async () => {
    globalThis.fetch = statefulPds(stateAt({ quest: { id: 'q-defeat', progress: 1 } })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('足りたら報酬パワーが入り、done に積まれ、quest が消える', async () => {
    const m = statefulPds(stateAt({ quest: { id: 'q-defeat', progress: 2 } }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.power).toBe(17); // 10 + 7
    expect(res.rewarded).toEqual({ power: 7 });
    const s = stored(m.store);
    expect(s.quest).toBeUndefined();
    expect(s.questsDone).toEqual(['q-defeat']);
  });

  it('受けていないクエストは達成できない', async () => {
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'not_accepted' });
  });

  it('達成済みは二重達成できない (二重報酬防止)', async () => {
    // quest が残ったまま done にもある壊れ state でも、done が勝つ
    globalThis.fetch = statefulPds(stateAt({ quest: { id: 'q-defeat', progress: 9 }, questsDone: ['q-defeat'] })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'already_done' });
  });
});

describe('handleQuestComplete (collect)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('素材が足りないと not_ready (権威在庫で検証)', async () => {
    globalThis.fetch = statefulPds(stateAt({ materials: { herb: 2 }, quest: { id: 'q-collect', progress: 0 } })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW)).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('達成で素材を引き取り、報酬 (パワー + アイテム) を付与する', async () => {
    const m = statefulPds(stateAt({ materials: { herb: 5 }, quest: { id: 'q-collect', progress: 0 } }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW);
    const s = stored(m.store);
    expect(s.materials['herb']).toBe(2); // 5 - 3 引き取られた
    expect(s.materials['sky-feather']).toBe(1); // 報酬アイテム
    expect(s.power).toBe(15); // 10 + 5
    expect(res.rewarded).toEqual({ power: 5, itemId: 'sky-feather', count: 1 });
  });

  it('ちょうど使い切ると素材キーが消える (0 を残さない)', async () => {
    const m = statefulPds(stateAt({ materials: { herb: 3 }, quest: { id: 'q-collect', progress: 0 } }));
    globalThis.fetch = m.fn;
    await handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW);
    expect(stored(m.store).materials['herb']).toBeUndefined();
  });
});

describe('applyBattleOutcome の討伐カウント', () => {
  const win = (state: GameState, ids: string[]) =>
    applyBattleOutcome(state, {
      outcome: 'win', monsterId: ids[0]!, archetype: 'guardian', luk: 0,
      enemyIds: ids, rewardSeed: 1, lossSeed: 2, rewarded: true,
    });

  it('対象モンスターを倒すと進行が増える (群れは頭数分)', async () => {
    const s = stateAt({ quest: { id: 'q-defeat', progress: 0 } });
    const { next } = win(s, [MON.id, MON.id]);
    expect(next.quest).toEqual({ id: 'q-defeat', progress: 2 });
  });

  it('対象外のモンスターでは進まない', async () => {
    const other = MONSTERS.find((m) => m.id !== MON.id)!;
    const s = stateAt({ quest: { id: 'q-defeat', progress: 1 } });
    const { next } = win(s, [other.id]);
    expect(next.quest).toEqual({ id: 'q-defeat', progress: 1 });
  });

  it('パワー無し (unrewarded) の練習戦では進まない', async () => {
    const s = stateAt({ quest: { id: 'q-defeat', progress: 0 } });
    const { next } = applyBattleOutcome(s, {
      outcome: 'win', monsterId: MON.id, archetype: 'guardian', luk: 0,
      rewardSeed: 1, lossSeed: 2, rewarded: false,
    });
    expect(next.quest).toEqual({ id: 'q-defeat', progress: 0 });
  });

  it('collect クエスト中の討伐では進まない', async () => {
    const s = stateAt({ quest: { id: 'q-collect', progress: 0 } });
    const { next } = win(s, [MON.id]);
    expect(next.quest).toEqual({ id: 'q-collect', progress: 0 });
  });
});
