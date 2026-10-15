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
import { starterTownNpcs, starterTownQuests, starterTownScenario, starterTownShop, setShopOverrides, worldOverlay, townShopStock, MONSTERS, setGameQuests, setNpcs, setScenario, type GameQuestDef } from '@aozoraquest/core';
import { handleQuestAccept, handleQuestComplete, GameQuestError } from '../src/game-quest';
import { applyBattleOutcome } from '../src/battle-reward';
import { advanceScenario } from '../src/scenario-progress';
import { handleGear } from '../src/battle-resolver';
import { shopCraft } from '../src/shop';
import { sanitizeGear, rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';
import { signPosition } from '../src/world-token';

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
  did: DID, activeQuests: [], power: 10, playerXp: 0, jobXp: {},
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

const TALK_Q: GameQuestDef = {
  id: 'q-letter', title: 'てがみ', npcId: 'npc-t1',
  intro: ['かじやに これを'], done: ['ありがとう'],
  objective: { kind: 'talk', npcId: 'npc-smith', line: 'おお、長老からの手紙か。' },
  reward: { power: 3 },
};

beforeAll(() => {
  setNpcs([
    { id: 'npc-t1', name: 'そんちょう', x: 5, y: 5, lines: ['こんにちは'] },
    { id: 'npc-t2', name: 'くすしや', x: 6, y: 5, lines: ['こんにちは'] },
    { id: 'npc-smith', name: 'かじや', mapId: 'old-town', x: 6, y: 6, lines: ['いらっしゃい'] },
  ]);
  setGameQuests([DEFEAT_Q, COLLECT_Q, TALK_Q]);
});

describe('handleQuestAccept', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('受注で quest が積まれる (progress 0)', async () => {
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.activeQuests).toEqual([{ id: 'q-defeat', progress: 0 }]);
    expect(stored(m.store).activeQuests).toEqual([{ id: 'q-defeat', progress: 0 }]);
  });

  it('未知のクエストは 404', async () => {
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestAccept(await makeEnv(), DID, 'nope', NOW)).rejects.toThrow(GameQuestError);
  });

  it('別クエスト進行中も追加できる', async () => {
    globalThis.fetch = statefulPds(stateAt({ activeQuests: [{ id: 'q-collect', progress: 0 }] })).fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.activeQuests).toEqual([{ id: 'q-collect', progress: 0 }, { id: 'q-defeat', progress: 0 }]);
  });

  it('同じクエストの再受注は no-op (連打・再送で壊れない)', async () => {
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 1 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.activeQuests).toEqual([{ id: 'q-defeat', progress: 1 }]); // progress を巻き戻さない
  });

  it('定義が消された孤児クエストを抱えていても、新しいクエストを受けられる', async () => {
    // Unknown IDs remain visible without blocking other acceptances.
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-deleted', progress: 3 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.activeQuests).toEqual([{ id: 'q-deleted', progress: 3 }, { id: 'q-defeat', progress: 0 }]);
    expect(stored(m.store).activeQuests).toEqual([{ id: 'q-deleted', progress: 3 }, { id: 'q-defeat', progress: 0 }]);
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
    globalThis.fetch = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 1 }] })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('足りたら報酬パワーが入り、done に積まれ、quest が消える', async () => {
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 2 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.power).toBe(17); // 10 + 7
    expect(res.rewarded).toEqual({ power: 7 });
    const s = stored(m.store);
    expect(s.activeQuests).toEqual([]);
    expect(s.questsDone).toEqual(['q-defeat']);
  });

  it('受けていないクエストは達成できない', async () => {
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'not_accepted' });
  });

  it('達成済みは二重達成できない (二重報酬防止)', async () => {
    // quest が残ったまま done にもある壊れ state でも、done が勝つ
    globalThis.fetch = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 9 }], questsDone: ['q-defeat'] })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'already_done' });
  });

  it('達成履歴が 200 件を超えても古い達成を落とさない (#709 再受注・二重報酬防止)', async () => {
    const old = ['q-collect', ...Array.from({ length: 199 }, (_, i) => `q-old-${i}`)];
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 2 }], questsDone: old }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    await handleQuestComplete(env, DID, 'q-defeat', NOW);
    expect(stored(m.store).questsDone).toEqual([...old, 'q-defeat']);
    await expect(handleQuestAccept(env, DID, 'q-collect', NOW)).rejects.toMatchObject({ code: 'already_done' });
  });
});

describe('handleQuestComplete (collect)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('素材が足りないと not_ready (権威在庫で検証)', async () => {
    globalThis.fetch = statefulPds(stateAt({ materials: { herb: 2 }, activeQuests: [{ id: 'q-collect', progress: 0 }] })).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW)).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('達成で素材を引き取り、報酬 (パワー + アイテム) を付与する', async () => {
    const m = statefulPds(stateAt({ materials: { herb: 5 }, activeQuests: [{ id: 'q-collect', progress: 0 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW);
    const s = stored(m.store);
    expect(s.materials['herb']).toBe(2); // 5 - 3 引き取られた
    expect(s.materials['sky-feather']).toBe(1); // 報酬アイテム
    expect(s.power).toBe(15); // 10 + 5
    expect(res.rewarded).toEqual({ power: 5, itemId: 'sky-feather', count: 1 });
  });

  it('ちょうど使い切ると素材キーが消える (0 を残さない)', async () => {
    const m = statefulPds(stateAt({ materials: { herb: 3 }, activeQuests: [{ id: 'q-collect', progress: 0 }] }));
    globalThis.fetch = m.fn;
    await handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW);
    expect(stored(m.store).materials['herb']).toBeUndefined();
  });
});

describe('handleQuestComplete (talk, D-STORY-009)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });
  const at = async (mapId: string, x: number, y: number) => signPosition(await makeEnv(), { did: DID, mapId, x, y, counter: 1, iat: NOW });

  it('相手の上下左右の隣のトークンで達成し、報酬が出る', async () => {
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-letter', progress: 0 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-letter', NOW, undefined, await at('old-town', 6, 7));
    expect(res.rewarded).toEqual({ power: 3 });
    expect(stored(m.store).questsDone).toContain('q-letter');
  });

  it('mapId 違い・斜め・同じマス・離れた位置・未受注は 400', async () => {
    for (const [mapId, x, y] of [['world', 6, 7], ['old-town', 7, 7], ['old-town', 6, 6], ['old-town', 6, 9]] as const) {
      globalThis.fetch = statefulPds(stateAt({ activeQuests: [{ id: 'q-letter', progress: 0 }] })).fn;
      await expect(handleQuestComplete(await makeEnv(), DID, 'q-letter', NOW, undefined, await at(mapId, x, y))).rejects.toMatchObject({ status: 400 });
    }
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestComplete(await makeEnv(), DID, 'q-letter', NOW, undefined, await at('old-town', 6, 7))).rejects.toMatchObject({ status: 400 });
  });
});

describe('applyBattleOutcome の討伐カウント', () => {
  const win = (state: GameState, ids: string[]) =>
    applyBattleOutcome(state, {
      outcome: 'win', monsterId: ids[0]!, archetype: 'guardian', luk: 0,
      enemyIds: ids, rewardSeed: 1, lossSeed: 2, rewarded: true,
    });

  it('対象モンスターを倒すと進行が増える (群れは頭数分)', async () => {
    const s = stateAt({ activeQuests: [{ id: 'q-defeat', progress: 0 }] });
    const { next } = win(s, [MON.id, MON.id]);
    expect(next.activeQuests).toEqual([{ id: 'q-defeat', progress: 2 }]);
  });

  it('対象外のモンスターでは進まない', async () => {
    const other = MONSTERS.find((m) => m.id !== MON.id)!;
    const s = stateAt({ activeQuests: [{ id: 'q-defeat', progress: 1 }] });
    const { next } = win(s, [other.id]);
    expect(next.activeQuests).toEqual([{ id: 'q-defeat', progress: 1 }]);
  });

  it('パワー無し (unrewarded) の練習戦では進まない', async () => {
    const s = stateAt({ activeQuests: [{ id: 'q-defeat', progress: 0 }] });
    const { next } = applyBattleOutcome(s, {
      outcome: 'win', monsterId: MON.id, archetype: 'guardian', luk: 0,
      rewardSeed: 1, lossSeed: 2, rewarded: false,
    });
    expect(next.activeQuests).toEqual([{ id: 'q-defeat', progress: 0 }]);
  });

  it('collect クエスト中の討伐では進まない', async () => {
    const s = stateAt({ activeQuests: [{ id: 'q-collect', progress: 0 }] });
    const { next } = win(s, [MON.id]);
    expect(next.activeQuests).toEqual([{ id: 'q-collect', progress: 0 }]);
  });
});

describe('シナリオ連動 (#545)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setScenario(null); });

  it('クエスト達成でフラグが立ち、お知らせが返る', async () => {
    setScenario([{ id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q-defeat' }], setFlags: ['ch1'], notice: '東の橋が なおったらしい' }]);
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 2 }] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.flags).toContain('ch1');
    expect(res.notices).toEqual(['東の橋が なおったらしい']);
    expect((stored(m.store) as GameState).flags).toContain('ch1');
  });

  it('解禁フラグが立っていないクエストはサーバーが受け付けない (直 POST でも)', async () => {
    // NPC の分岐を無視して直接叩いても通らないことを確かめる。
    setGameQuests([{ ...DEFEAT_Q, requireFlags: ['ch1'] }, COLLECT_Q]);
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW)).rejects.toMatchObject({ code: 'locked' });
    // フラグが立っていれば通る
    globalThis.fetch = statefulPds(stateAt({ flags: ['ch1'] })).fn;
    const ok = await handleQuestAccept(await makeEnv(), DID, 'q-defeat', NOW);
    expect(ok.activeQuests).toEqual([{ id: 'q-defeat', progress: 0 }]);
    setGameQuests([DEFEAT_Q, COLLECT_Q]);
  });

  it('達成の応答に演出付きの scenarioMessages を返す (D-STORY-007)', async () => {
    setScenario([{ id: 'e1', title: '引き', when: [{ kind: 'questDone', questId: 'q-defeat' }], setFlags: ['ch1'], notice: 'そらが ひかった', effects: [{ kind: 'tint', color: 'red' }] }]);
    globalThis.fetch = statefulPds(stateAt({ activeQuests: [{ id: 'q-defeat', progress: 2 }] })).fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-defeat', NOW);
    expect(res.notices).toEqual(['そらが ひかった']);
    expect(res.scenarioMessages).toEqual([{ text: 'そらが ひかった', effects: [{ kind: 'tint', color: 'red' }] }]);
  });

  it('advanceScenario は戦闘決着にも渡す messages を notice 付きイベントだけから作る', () => {
    setScenario([
      { id: 'e1', title: 'a', when: [{ kind: 'questDone', questId: 'q-defeat' }], setFlags: ['ch1'], notice: 'あかい', effects: [{ kind: 'flash', color: 'red' }] },
      { id: 'e2', title: 'b', when: [{ kind: 'questDone', questId: 'q-defeat' }], setFlags: ['ch2'] },
      { id: 'e3', title: 'c', when: [{ kind: 'questDone', questId: 'q-defeat' }], setFlags: ['ch3'], notice: 'ふつう' },
    ]);
    const r = advanceScenario(stateAt({ questsDone: ['q-defeat'] }));
    expect(r?.messages).toEqual([{ text: 'あかい', effects: [{ kind: 'flash', color: 'red' }] }, { text: 'ふつう' }]);
  });

  it('既にフラグが立っていれば同じお知らせを二度出さない', async () => {
    setScenario([{ id: 'e1', title: '第1章', when: [{ kind: 'questDone', questId: 'q-collect' }], setFlags: ['ch1'], notice: 'もう出ない' }]);
    const m = statefulPds(stateAt({ materials: { herb: 5 }, activeQuests: [{ id: 'q-collect', progress: 0 }], flags: ['ch1'] }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, 'q-collect', NOW);
    expect(res.notices).toBeUndefined();
  });
});

// The tutorial uses the existing CAS/reward/shop paths, not a test-only quest engine.
describe('ふたばの村: 受注から報告・制作・次の依頼へ', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setScenario(null); setGameQuests(null); setNpcs(null); setShopOverrides(null);
  });

  it('0powerで受注可能だが進まない。3勝して報告し、一度だけ受領→制作・装備→3依頼を報告', async () => {
    setNpcs(starterTownNpcs());
    setGameQuests(starterTownQuests());
    setScenario(starterTownScenario());
    const town = worldOverlay().towns[0]!;
    setShopOverrides([starterTownShop(town, townShopStock(town, 0))]);
    const m = statefulPds(stateAt({ x: town.x, y: town.y, power: 0, materials: {} }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    await expect(handleQuestAccept(env, DID, 'futaba-herbs', NOW)).rejects.toMatchObject({ code: 'locked' });
    await handleQuestAccept(env, DID, 'futaba-slimes', NOW);
    const outcome = { outcome: 'win' as const, monsterId: 'sky-slime', archetype: 'warrior' as const, luk: 10, rewardSeed: 12345, lossSeed: 67890, rewarded: false };
    expect(applyBattleOutcome(stored(m.store), outcome).next.activeQuests[0]?.progress).toBe(0);
    await expect(handleQuestComplete(env, DID, 'futaba-slimes', NOW)).rejects.toMatchObject({ code: 'not_ready' });
    // Isolated fixture models returning after an optional post; no new grant API is implemented.
    let s = { ...stored(m.store), power: 3 };
    for (let i = 0; i < 3; i++) s = applyBattleOutcome(s, { ...outcome, rewarded: true }).next;
    m.store.set(rkeyForDid(DID), { value: s, cid: 'battle-final' });
    expect(s.activeQuests[0]?.progress).toBe(3);
    expect(s.power).toBe(0);
    const results = await Promise.allSettled([
      handleQuestComplete(env, DID, 'futaba-slimes', NOW),
      handleQuestComplete(env, DID, 'futaba-slimes', NOW),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(stored(m.store).power).toBe(4);
    expect(stored(m.store).flags).toContain('futaba_slimes_done');
    const craft = await shopCraft(env, DID, { itemId: 'ar-cloth', rkey: 'tutorial-cloth', luk: 10 }, NOW);
    expect(craft.power).toBe(0);
    expect(craft.pieces?.[0]?.itemId).toBe('ar-cloth');
    const selection = { armor: { id: 'ar-cloth', level: craft.level! } };
    expect(sanitizeGear(selection, craft.pieces!)).toEqual(selection);
    await handleGear(env, DID, selection, NOW);
    expect(stored(m.store).gearSel).toEqual(selection);
    await expect(handleQuestComplete(env, DID, 'futaba-slimes', NOW)).rejects.toMatchObject({ code: 'already_done' });
    await handleQuestAccept(env, DID, 'futaba-herbs', NOW);
    m.store.set(rkeyForDid(DID), { value: { ...stored(m.store), materials: { herb: 2 } }, cid: 'collected-2' });
    await expect(handleQuestComplete(env, DID, 'futaba-herbs', NOW)).rejects.toMatchObject({ code: 'not_ready' });
    m.store.set(rkeyForDid(DID), { value: { ...stored(m.store), materials: { herb: 3, 'bat-wing': 2 } }, cid: 'collected-3' });
    await handleQuestComplete(env, DID, 'futaba-herbs', NOW);
    expect(stored(m.store).materials.herb).toBe(1);
    expect(stored(m.store).flags).toContain('futaba_herbs_done');
    await handleQuestAccept(env, DID, 'futaba-wings', NOW);
    await handleQuestComplete(env, DID, 'futaba-wings', NOW);
    expect(stored(m.store).materials['bat-wing'] ?? 0).toBe(0);
    expect(stored(m.store).flags).toContain('futaba_wings_done');
    expect(stored(m.store).questsDone).toEqual(['futaba-slimes', 'futaba-herbs', 'futaba-wings']);
    expect(stored(m.store).activeQuests).toEqual([]);
  });
});


describe('ギルド素材納品 (#707): 既存在庫と一度だけの権威報酬', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; setScenario(null); setGameQuests(null); setNpcs(null); });

  it('不足・未受注では消費せず、成功時のみ消費2/やくそう2/power5、並行/再送は一度だけ', async () => {
    setNpcs(starterTownNpcs()); setGameQuests(starterTownQuests());
    const m = statefulPds(stateAt({ materials: { 'slime-drop': 1, herb: 4 } }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const id = 'futaba-tool-care';
    await expect(handleQuestComplete(env, DID, id, NOW)).rejects.toMatchObject({ code: 'not_accepted' });
    await handleQuestAccept(env, DID, id, NOW);
    const before = stored(m.store);
    await expect(handleQuestComplete(env, DID, id, NOW)).rejects.toMatchObject({ code: 'not_ready' });
    expect(stored(m.store)).toEqual(before);
    m.store.set(rkeyForDid(DID), { value: { ...before, materials: { 'slime-drop': 3, herb: 4 } }, cid: 'gathered' });
    const results = await Promise.allSettled([handleQuestComplete(env, DID, id, NOW), handleQuestComplete(env, DID, id, NOW)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(stored(m.store).materials).toEqual({ 'slime-drop': 1, herb: 6 });
    expect(stored(m.store).power).toBe(15);
    const done = stored(m.store);
    await expect(handleQuestComplete(env, DID, id, NOW)).rejects.toMatchObject({ code: 'already_done' });
    await expect(handleQuestAccept(env, DID, id, NOW)).rejects.toMatchObject({ code: 'already_done' });
    expect(stored(m.store)).toEqual(done);
  });

  it('既存討伐の保存進捗を保持し、直接報告後は受注前の在庫をそのまま納品できる', async () => {
    setNpcs(starterTownNpcs()); setGameQuests(starterTownQuests()); setScenario(starterTownScenario());
    const m = statefulPds(stateAt({ activeQuests: [{ id: 'futaba-slimes', progress: 3 }], materials: { 'slime-drop': 2 } }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    await handleQuestAccept(env, DID, 'futaba-tool-care', NOW);
    expect(stored(m.store).activeQuests).toEqual([{ id: 'futaba-slimes', progress: 3 }, { id: 'futaba-tool-care', progress: 0 }]);
    await handleQuestComplete(env, DID, 'futaba-slimes', NOW);
    expect(stored(m.store).flags).toContain('futaba_slimes_done');
    await handleQuestAccept(env, DID, 'futaba-tool-care', NOW);
    await handleQuestComplete(env, DID, 'futaba-tool-care', NOW);
    expect(stored(m.store).questsDone).toEqual(['futaba-slimes', 'futaba-tool-care']);
    expect(stored(m.store).materials).toEqual({ 'slime-drop': 1, herb: 2 });
    expect(stored(m.store).power).toBe(19);
  });
});

describe('D-GUILD-002 multi-active authority', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; setScenario(null); setGameQuests(null); setNpcs(null); });

  it('parallel independent acceptance preserves both; guild report preserves defeat progress and story locks', async () => {
    setNpcs(starterTownNpcs()); setGameQuests(starterTownQuests()); setScenario(starterTownScenario());
    const m = statefulPds(stateAt({ activeQuests: [], materials: { 'slime-drop': 2 } }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const accepted = await Promise.allSettled(['futaba-slimes', 'futaba-tool-care'].map(id => handleQuestAccept(env, DID, id, NOW)));
    expect(accepted.every(r => r.status === 'fulfilled')).toBe(true);
    expect(stored(m.store).activeQuests.map(q => q.id).sort()).toEqual(['futaba-slimes', 'futaba-tool-care']);
    const next = applyBattleOutcome(stored(m.store), { outcome: 'win', monsterId: 'sky-slime', archetype: 'warrior', luk: 0, rewardSeed: 1, lossSeed: 2, rewarded: true }).next;
    m.store.set(rkeyForDid(DID), { value: next, cid: 'battle' });
    await handleQuestAccept(env, DID, 'futaba-slimes', NOW);
    await handleQuestComplete(env, DID, 'futaba-tool-care', NOW);
    expect(stored(m.store).activeQuests).toEqual([{ id: 'futaba-slimes', progress: 1 }]);
    expect(stored(m.store).flags ?? []).not.toContain('futaba_slimes_done');
    await expect(handleQuestAccept(env, DID, 'futaba-herbs', NOW)).rejects.toMatchObject({ code: 'locked' });
  });

  it('same-ID acceptance is one entry and preserves progress after prerequisite item loss', async () => {
    setNpcs(starterTownNpcs());
    const q = { ...starterTownQuests()[0]!, requireItems: [{ itemId: 'herb', count: 1 }] };
    setGameQuests([q]);
    const m = statefulPds(stateAt({ materials: { herb: 1 } })); globalThis.fetch = m.fn;
    const env = await makeEnv();
    await Promise.all([handleQuestAccept(env, DID, q.id, NOW), handleQuestAccept(env, DID, q.id, NOW)]);
    expect(stored(m.store).activeQuests).toEqual([{ id: q.id, progress: 0 }]);
    m.store.set(rkeyForDid(DID), { value: { ...stored(m.store), materials: {}, activeQuests: [{ id: q.id, progress: 3 }] }, cid: 'lost-item' });
    await handleQuestAccept(env, DID, q.id, NOW);
    expect(m.store.get(rkeyForDid(DID))!.cid).toBe('lost-item');
    expect(stored(m.store).activeQuests).toEqual([{ id: q.id, progress: 3 }]);
  });

  it('selected B alone completes; same-material reward is added after consumption', async () => {
    setNpcs(starterTownNpcs());
    const a = starterTownQuests().find(q => q.id === 'futaba-tool-care')!;
    const b = { ...a, id: 'fixture-b', reward: { itemId: 'slime-drop', count: 1, power: 8 } };
    setGameQuests([a, b]);
    const m = statefulPds(stateAt({ activeQuests: [{ id: a.id, progress: 4 }, { id: b.id, progress: 0 }], materials: { 'slime-drop': 2 } }));
    globalThis.fetch = m.fn;
    const res = await handleQuestComplete(await makeEnv(), DID, b.id, NOW);
    expect(res.activeQuests).toEqual([{ id: a.id, progress: 4 }]);
    expect(res.questsDone).toEqual([b.id]);
    expect(res.materials).toEqual({ 'slime-drop': 1 });
    expect(res.power).toBe(18);
  });

  it.each([2, 4])('two material quests compete for actual inventory %i in CAS', async (count) => {
    setNpcs(starterTownNpcs());
    const a = starterTownQuests().find(q => q.id === 'futaba-tool-care')!;
    const b = { ...a, id: 'fixture-b', reward: { power: 8 } };
    setGameQuests([a, b]);
    const m = statefulPds(stateAt({ activeQuests: [a, b].map(q => ({ id: q.id, progress: 0 })), materials: { 'slime-drop': count } }));
    globalThis.fetch = m.fn;
    const env = await makeEnv();
    const results = await Promise.allSettled([a, b].map(q => handleQuestComplete(env, DID, q.id, NOW)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(count / 2);
    expect(stored(m.store).materials['slime-drop'] ?? 0).toBe(0);
    expect(stored(m.store).activeQuests).toHaveLength(2 - count / 2);
    expect(stored(m.store).power).toBe(count === 4 ? 23 : 15);
    if (count === 2) expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'not_ready' } });
  });
});
