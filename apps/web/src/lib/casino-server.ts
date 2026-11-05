/**
 * カジノの edge 呼び出し (D-CASINO-001)。コインの増減と結果はサーバーが決める。画面はその結果を見せるだけ。
 * rkey は 1 回の操作ごとに作り、通信が失敗したときは同じ rkey で送り直す (二重に払わない)。
 */
import type { Agent } from '@atproto/api';
import { LXM, type CasinoOutcome } from '@aozoraquest/core';
import { callEdge } from './world-server';

export interface CasinoRunner { id: string; name: string; species: string }
export interface CasinoResult {
  coins: number;
  duplicate?: boolean;
  power?: number;
  outcomes?: CasinoOutcome[];
  highlow?: { first: number; stake: number; step: number; canContinue: boolean };
  cashout?: number;
  race?: { runners: CasinoRunner[] };
  pieces?: Array<{ rkey: string; itemId: string; level: number }>;
  materials?: Record<string, number>;
}

export const casinoExchange = (agent: Agent, power: number, rkey: string, token?: string) =>
  callEdge<CasinoResult>(agent, LXM.casinoExchange, '/api/casino/exchange', { power, rkey, ...(token ? { token } : {}) });
export const casinoBonus = (agent: Agent, rkey: string, token?: string) =>
  callEdge<CasinoResult>(agent, LXM.casinoBonus, '/api/casino/bonus', { rkey, ...(token ? { token } : {}) });
export const casinoPrize = (agent: Agent, prizeId: string, rkey: string, token?: string) =>
  callEdge<CasinoResult>(agent, LXM.casinoPrize, '/api/casino/prize', { prizeId, rkey, ...(token ? { token } : {}) });
export const casinoPlay = (agent: Agent, body: { game: string; bet?: number; choice?: Record<string, unknown> }, rkey: string, token?: string) =>
  callEdge<CasinoResult>(agent, LXM.casinoPlay, '/api/casino/play', { ...body, rkey, ...(token ? { token } : {}) });
export const casinoRace = (agent: Agent, rkey: string, token?: string) =>
  callEdge<{ runners: CasinoRunner[] }>(agent, LXM.casinoPlay, '/api/casino/race', { rkey, ...(token ? { token } : {}) });

export const newCasinoRkey = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
