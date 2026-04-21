import { z } from 'zod';

// ─────────────────────────────────────────────────
// Common primitives
// ─────────────────────────────────────────────────

const Datetime = z.string().datetime();
const Did = z.string().regex(/^did:/, 'invalid DID');
const ArchetypeEnum = z.enum([
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'dancer',
  'captain', 'miko', 'gladiator', 'performer',
]);

const StatScore = z.number().int().min(0).max(100);
const StatVectorSchema = z.object({
  atk: StatScore,
  def: StatScore,
  agi: StatScore,
  int: StatScore,
  luk: StatScore,
}).refine(
  (v) => {
    const total = v.atk + v.def + v.agi + v.int + v.luk;
    return Math.abs(total - 100) <= 2; // allow rounding
  },
  { message: 'stat vector must sum to ~100' },
);

const CognitiveScoresSchema = z.object({
  Ni: StatScore, Ne: StatScore, Si: StatScore, Se: StatScore,
  Ti: StatScore, Te: StatScore, Fi: StatScore, Fe: StatScore,
});

// ─────────────────────────────────────────────────
// User-owned lexicons
// ─────────────────────────────────────────────────

export const ProfileSchema = z.object({
  targetJob: ArchetypeEnum,
  nameVariant: z.enum(['default', 'maker', 'alt']).default('default'),
  publicAnalysis: z.boolean().default(false),
  discoverable: z.boolean().default(false),
  spiritStyle: z.enum(['sky']).default('sky'),
  updatedAt: Datetime,
});
export type Profile = z.infer<typeof ProfileSchema>;

export const AnalysisSchema = z.object({
  archetype: ArchetypeEnum,
  rpgStats: StatVectorSchema,
  cognitiveScores: CognitiveScoresSchema,
  confidence: z.enum(['high', 'medium', 'low', 'ambiguous', 'insufficient']),
  analyzedPostCount: z.number().int().min(0),
  analyzedAt: Datetime,
  public: z.boolean().default(false),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const QuestEntrySchema = z.object({
  id: z.string(),
  templateId: z.string(),
  type: z.enum(['growth', 'maintenance', 'restraint']),
  targetStat: z.enum(['atk', 'def', 'agi', 'int', 'luk']),
  requiredCount: z.number().int().min(0),
  currentCount: z.number().int().min(0),
  completed: z.boolean(),
  xpAwarded: z.number().int().min(0).optional(),
});

export const QuestLogSchema = z.object({
  date: Datetime,
  quests: z.array(QuestEntrySchema),
  totalXpGained: z.number().int().min(0).optional(),
  updatedAt: Datetime,
});
export type QuestLog = z.infer<typeof QuestLogSchema>;

export const CompanionSchema = z.object({
  companions: z.array(z.object({
    did: Did,
    addedAt: Datetime,
    resonanceSnapshot: z.number().min(0).max(1).optional(),
    note: z.string().max(200).optional(),
  })),
  updatedAt: Datetime,
});
export type Companion = z.infer<typeof CompanionSchema>;

export const CompanionLogSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'spirit']),
    text: z.string().max(2000),
    at: Datetime,
  })),
  startedAt: Datetime,
  endedAt: Datetime.optional(),
});
export type CompanionLog = z.infer<typeof CompanionLogSchema>;

// ─────────────────────────────────────────────────
// Admin-owned config lexicons
// ─────────────────────────────────────────────────

export const FlagSchema = z.object({
  enabled: z.boolean(),
  rollout: z.number().int().min(0).max(100),
  description: z.string().max(200),
});

export const ConfigFlagsSchema = z.object({
  flags: z.record(z.string(), FlagSchema),
  updatedAt: Datetime,
});
export type ConfigFlags = z.infer<typeof ConfigFlagsSchema>;

export const ConfigPromptSchema = z.object({
  id: z.enum(['spiritChat', 'draftPost', 'advancedDiagnosis']),
  body: z.string().max(8000),
  notes: z.string().max(500).optional(),
  updatedAt: Datetime,
});
export type ConfigPrompt = z.infer<typeof ConfigPromptSchema>;

export const ConfigMaintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().max(500).optional(),
  until: Datetime.optional(),
  allowedDids: z.array(Did).optional(),
  updatedAt: Datetime,
});
export type ConfigMaintenance = z.infer<typeof ConfigMaintenanceSchema>;

export const ConfigBansSchema = z.object({
  dids: z.array(Did),
  notes: z.record(z.string(), z.string()).optional(),
  updatedAt: Datetime,
});
export type ConfigBans = z.infer<typeof ConfigBansSchema>;

export const DirectorySchema = z.object({
  users: z.array(z.object({
    did: Did,
    addedAt: Datetime,
    note: z.string().max(200).optional(),
  })),
  updatedAt: Datetime,
});
export type Directory = z.infer<typeof DirectorySchema>;

// ─────────────────────────────────────────────────
// Runtime config loaded from admin PDS
// ─────────────────────────────────────────────────

export interface RuntimeConfig {
  flags: ConfigFlags['flags'];
  maintenance: ConfigMaintenance;
  bans: ConfigBans['dids'];
  prompts: Partial<Record<ConfigPrompt['id'], ConfigPrompt>>;
  directory: Directory['users'];
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  flags: {},
  maintenance: { enabled: false, updatedAt: new Date(0).toISOString() },
  bans: [],
  prompts: {},
  directory: [],
};
