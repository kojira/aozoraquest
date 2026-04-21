/**
 * AT Protocol レキシコン JSON の集約エクスポート。
 * Zod スキーマ + TypeScript 型を生成し、読み取り/書き込み時のバリデーションに使う。
 */

import profileJson from './app/aozoraquest/profile.json' with { type: 'json' };
import analysisJson from './app/aozoraquest/analysis.json' with { type: 'json' };
import questLogJson from './app/aozoraquest/questLog.json' with { type: 'json' };
import companionJson from './app/aozoraquest/companion.json' with { type: 'json' };
import companionLogJson from './app/aozoraquest/companionLog.json' with { type: 'json' };
import directoryJson from './app/aozoraquest/directory.json' with { type: 'json' };
import flagsJson from './app/aozoraquest/config/flags.json' with { type: 'json' };
import promptsJson from './app/aozoraquest/config/prompts.json' with { type: 'json' };
import maintenanceJson from './app/aozoraquest/config/maintenance.json' with { type: 'json' };
import bansJson from './app/aozoraquest/config/bans.json' with { type: 'json' };

export const LEXICON_DOCS = {
  'app.aozoraquest.profile': profileJson,
  'app.aozoraquest.analysis': analysisJson,
  'app.aozoraquest.questLog': questLogJson,
  'app.aozoraquest.companion': companionJson,
  'app.aozoraquest.companionLog': companionLogJson,
  'app.aozoraquest.directory': directoryJson,
  'app.aozoraquest.config.flags': flagsJson,
  'app.aozoraquest.config.prompts': promptsJson,
  'app.aozoraquest.config.maintenance': maintenanceJson,
  'app.aozoraquest.config.bans': bansJson,
} as const;

export type LexiconNsid = keyof typeof LEXICON_DOCS;

export const USER_LEXICONS = [
  'app.aozoraquest.profile',
  'app.aozoraquest.analysis',
  'app.aozoraquest.questLog',
  'app.aozoraquest.companion',
  'app.aozoraquest.companionLog',
] as const satisfies readonly LexiconNsid[];

export const ADMIN_LEXICONS = [
  'app.aozoraquest.directory',
  'app.aozoraquest.config.flags',
  'app.aozoraquest.config.prompts',
  'app.aozoraquest.config.maintenance',
  'app.aozoraquest.config.bans',
] as const satisfies readonly LexiconNsid[];
