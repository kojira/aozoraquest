/**
 * Worker 未デプロイ時の questIndex モック。localStorage に集約データを保持し、
 * 全クライアント (= 同一ブラウザ内の他タブ) で共有する。
 *
 * Phase 1 PoC + ローカル開発用。本番では VITE_QUEST_EDGE_URL を設定して
 * Worker (apps/edge) 経由に切り替える。
 */

import type { AtUri, Did } from '@aozoraquest/core';
import type { QuestIndex, QuestIndexSummary, ApplicationIndexEntry, UserQuest } from './quest-api';

const KEY = 'aozoraquest:questIndex:mock';

function load(): QuestIndex {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as QuestIndex;
    if (!Array.isArray(parsed.quests) || !Array.isArray(parsed.applications)) return empty();
    return parsed;
  } catch {
    return empty();
  }
}

function save(idx: QuestIndex) {
  try {
    localStorage.setItem(KEY, JSON.stringify(idx));
  } catch {
    /* no-op (private mode 等で SecurityError) */
  }
}

function empty(): QuestIndex {
  return { quests: [], applications: [], updatedAt: new Date().toISOString() };
}

function toSummary(q: UserQuest): QuestIndexSummary {
  const base: QuestIndexSummary = {
    uri: q.uri,
    did: q.did,
    title: q.title,
    tags: q.tags,
    rewardPoints: q.rewardPoints,
    status: q.status,
    createdAt: q.createdAt,
  };
  if (q.deadline !== undefined) base.deadline = q.deadline;
  // 受託者情報を summary に載せる (これが無いと mock fallback 時に「受託中」判定や
  // 複数受託の表示が消える)。legacy 単数 assignee と新形式 assignees の両方を運ぶ。
  if (q.assignee !== undefined) base.assignee = q.assignee;
  if (q.assignees !== undefined) base.assignees = q.assignees;
  if (q.maxAssignees !== undefined) base.maxAssignees = q.maxAssignees;
  return base;
}

interface MockIndex {
  (): QuestIndex;
  addQuest(q: UserQuest): void;
  updateQuestStatus(uri: AtUri, status: string): void;
  addApplication(a: { uri: AtUri; did: Did; questUri: AtUri; createdAt: string }): void;
  clear(): void;
}

export const mockIndex: MockIndex = Object.assign(
  function (): QuestIndex {
    return load();
  },
  {
    addQuest(q: UserQuest) {
      const idx = load();
      const i = idx.quests.findIndex(x => x.uri === q.uri);
      if (i >= 0) idx.quests[i] = toSummary(q);
      else idx.quests.unshift(toSummary(q));
      idx.updatedAt = new Date().toISOString();
      save(idx);
    },
    updateQuestStatus(uri: AtUri, status: string) {
      const idx = load();
      const i = idx.quests.findIndex(x => x.uri === uri);
      const existing = idx.quests[i];
      if (existing) {
        idx.quests[i] = { ...existing, status };
        idx.updatedAt = new Date().toISOString();
        save(idx);
      }
    },
    addApplication(a: ApplicationIndexEntry) {
      const idx = load();
      if (!idx.applications.find(x => x.uri === a.uri)) {
        idx.applications.unshift(a);
        idx.updatedAt = new Date().toISOString();
        save(idx);
      }
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
      } catch {/* no-op */}
    },
  },
);
