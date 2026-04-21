# 08 - PDS データスキーマ

## 概要

Aozora Quest のすべてのユーザー固有データは、ユーザー自身の AT Protocol PDS に保存される。アプリ側はデータベースを持たない。

レキシコンは `app.aozoraquest.*` 名前空間で定義する。この名前空間は Cloudflare Registrar で購入した `aozoraquest.app` の逆ドメインに基づく。

## レコード一覧

| NSID | 内容 | rkey |
|---|---|---|
| `app.aozoraquest.profile` | 目標ジョブ、表示設定、公開設定 | `self` |
| `app.aozoraquest.analysis` | 気質診断結果 | `self` |
| `app.aozoraquest.questLog` | クエスト進捗と履歴 | タイムスタンプベース |
| `app.aozoraquest.companion` | 旅の仲間リスト | `self` |
| `app.aozoraquest.companionLog` | 精霊との会話履歴 | タイムスタンプベース |

`rkey = self` は「1 ユーザーにつき 1 レコード」のシングルトン扱い。

## レキシコン定義

以下、各レキシコンの JSON スキーマ (AT Protocol 形式)。

### app.aozoraquest.profile

ユーザーの設定と目標ジョブを保持する。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.profile",
  "defs": {
    "main": {
      "type": "record",
      "description": "User profile settings and target job for Aozora Quest",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["targetJob", "nameVariant", "updatedAt"],
        "properties": {
          "targetJob": {
            "type": "string",
            "description": "Target job id (e.g., 'sage', 'explorer')",
            "knownValues": [
              "sage", "mage", "shogun", "bard",
              "seer", "poet", "paladin", "explorer",
              "warrior", "guardian", "fighter", "artist",
              "captain", "miko", "ninja", "performer"
            ]
          },
          "nameVariant": {
            "type": "string",
            "description": "Job display name variant",
            "knownValues": ["default", "maker", "alt"],
            "default": "default"
          },
          "publicAnalysis": {
            "type": "boolean",
            "description": "Whether to publish analysis results for compatibility lookup",
            "default": false
          },
          "discoverable": {
            "type": "boolean",
            "description": "Opt-in flag: if true, this user can be added to the admin directory for the 共鳴 timeline (05-compatibility.md)",
            "default": false
          },
          "spiritStyle": {
            "type": "string",
            "description": "Spirit character variant (future)",
            "knownValues": ["sky"],
            "default": "sky"
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

### app.aozoraquest.analysis

気質診断の結果と履歴。`self` レコードには最新結果が入り、別途履歴を保持する (rkey を timestamp にしたレコードを追加)。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.analysis",
  "defs": {
    "main": {
      "type": "record",
      "description": "Aozora Quest temperament analysis result",
      "key": "any",
      "record": {
        "type": "object",
        "required": [
          "archetype",
          "rpgStats",
          "cognitiveScores",
          "confidence",
          "analyzedPostCount",
          "analyzedAt"
        ],
        "properties": {
          "archetype": {
            "type": "string",
            "description": "Determined archetype id (internal identifier like 'sage')",
            "knownValues": [
              "sage", "mage", "shogun", "bard",
              "seer", "poet", "paladin", "explorer",
              "warrior", "guardian", "fighter", "artist",
              "captain", "miko", "ninja", "performer"
            ]
          },
          "rpgStats": {
            "type": "ref",
            "ref": "#statVector"
          },
          "cognitiveScores": {
            "type": "ref",
            "ref": "#cognitiveScores"
          },
          "confidence": {
            "type": "string",
            "knownValues": ["high", "medium", "low", "ambiguous", "insufficient"]
          },
          "analyzedPostCount": {
            "type": "integer",
            "minimum": 0
          },
          "analyzedAt": {
            "type": "string",
            "format": "datetime"
          },
          "public": {
            "type": "boolean",
            "default": false
          }
        }
      }
    },
    "statVector": {
      "type": "object",
      "description": "Normalized RPG stats (sum equals 100)",
      "required": ["atk", "def", "agi", "int", "luk"],
      "properties": {
        "atk": { "type": "integer", "minimum": 0, "maximum": 100 },
        "def": { "type": "integer", "minimum": 0, "maximum": 100 },
        "agi": { "type": "integer", "minimum": 0, "maximum": 100 },
        "int": { "type": "integer", "minimum": 0, "maximum": 100 },
        "luk": { "type": "integer", "minimum": 0, "maximum": 100 }
      }
    },
    "cognitiveScores": {
      "type": "object",
      "description": "Jungian cognitive function scores (0-100 each)",
      "required": ["Ni", "Ne", "Si", "Se", "Ti", "Te", "Fi", "Fe"],
      "properties": {
        "Ni": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Ne": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Si": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Se": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Ti": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Te": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Fi": { "type": "integer", "minimum": 0, "maximum": 100 },
        "Fe": { "type": "integer", "minimum": 0, "maximum": 100 }
      }
    }
  }
}
```

### app.aozoraquest.questLog

クエスト進捗と達成履歴。1 日 1 レコード。rkey は日付 (`YYYY-MM-DD` 形式)。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.questLog",
  "defs": {
    "main": {
      "type": "record",
      "description": "Daily quest progress and completion record",
      "key": "any",
      "record": {
        "type": "object",
        "required": ["date", "quests", "xpEarned", "streakDays"],
        "properties": {
          "date": {
            "type": "string",
            "description": "YYYY-MM-DD format"
          },
          "quests": {
            "type": "array",
            "items": { "type": "ref", "ref": "#questEntry" }
          },
          "xpEarned": {
            "type": "integer",
            "minimum": 0
          },
          "streakDays": {
            "type": "integer",
            "minimum": 0
          },
          "maxCombo": {
            "type": "integer",
            "minimum": 1
          },
          "levelAtEnd": {
            "type": "integer",
            "minimum": 1
          }
        }
      }
    },
    "questEntry": {
      "type": "object",
      "required": ["templateId", "targetStat", "targetCount", "actualCount", "completed"],
      "properties": {
        "templateId": {
          "type": "string",
          "description": "Reference to QUEST_TEMPLATES (e.g., 'agi_short_post')"
        },
        "type": {
          "type": "string",
          "knownValues": ["growth", "maintain", "restraint"]
        },
        "targetStat": {
          "type": "string",
          "knownValues": ["atk", "def", "agi", "int", "luk"]
        },
        "targetCount": { "type": "integer", "minimum": 1 },
        "actualCount": { "type": "integer", "minimum": 0 },
        "completed": { "type": "boolean" },
        "xpReward": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

### app.aozoraquest.companion

旅の仲間リスト。共鳴度の高いユーザーを手動または自動で追加。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.companion",
  "defs": {
    "main": {
      "type": "record",
      "description": "User's companion list (travel partners)",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["companions", "updatedAt"],
        "properties": {
          "companions": {
            "type": "array",
            "maxLength": 100,
            "items": { "type": "ref", "ref": "#companionEntry" }
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "companionEntry": {
      "type": "object",
      "required": ["did", "resonance", "addedAt"],
      "properties": {
        "did": {
          "type": "string",
          "format": "did"
        },
        "resonance": {
          "type": "number",
          "description": "Compatibility score (0.0-1.0)",
          "minimum": 0,
          "maximum": 1
        },
        "partnerArchetype": {
          "type": "string",
          "description": "Companion's archetype at the time of addition"
        },
        "pairTitle": {
          "type": "string",
          "description": "Special pair title if any (e.g., 'traveling-philosopher')"
        },
        "addedAt": {
          "type": "string",
          "format": "datetime"
        }
      }
    }
  }
}
```

### app.aozoraquest.companionLog

精霊との会話履歴。BYOK で自由対話を行ったユーザーのみ使用。rkey はタイムスタンプ。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.companionLog",
  "defs": {
    "main": {
      "type": "record",
      "description": "Conversation log with the spirit companion",
      "key": "any",
      "record": {
        "type": "object",
        "required": ["messages", "startedAt"],
        "properties": {
          "messages": {
            "type": "array",
            "items": { "type": "ref", "ref": "#message" }
          },
          "startedAt": {
            "type": "string",
            "format": "datetime"
          },
          "endedAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    },
    "message": {
      "type": "object",
      "required": ["role", "text", "at"],
      "properties": {
        "role": {
          "type": "string",
          "knownValues": ["user", "spirit"]
        },
        "text": {
          "type": "string",
          "maxLength": 2000
        },
        "at": {
          "type": "string",
          "format": "datetime"
        }
      }
    }
  }
}
```

## 管理者コンフィグレキシコン

運用コンフィグは主管理者 DID の PDS に格納される (14-admin.md)。全クライアント が boot 時にこれを読み取って起動する。

| NSID | rkey | 内容 |
|---|---|---|
| `app.aozoraquest.config.flags` | `self` | フィーチャーフラグ |
| `app.aozoraquest.config.prompts` | 任意 (`spiritChat`, `draftPost` など) | システムプロンプト |
| `app.aozoraquest.config.maintenance` | `self` | メンテナンスモード |
| `app.aozoraquest.config.bans` | `self` | BAN DID リスト |
| `app.aozoraquest.directory` | `self` | 共鳴タイムライン用の発見可能ユーザー DID リスト |

### app.aozoraquest.config.flags

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.config.flags",
  "defs": {
    "main": {
      "type": "record",
      "description": "Feature flags for Aozora Quest",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["flags", "updatedAt"],
        "properties": {
          "flags": {
            "type": "unknown",
            "description": "Map of flag id to { enabled, rollout, description }"
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

### app.aozoraquest.config.prompts

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.config.prompts",
  "defs": {
    "main": {
      "type": "record",
      "description": "System prompt for a specific Claude-backed feature",
      "key": "any",
      "record": {
        "type": "object",
        "required": ["id", "body", "updatedAt"],
        "properties": {
          "id": {
            "type": "string",
            "knownValues": ["spiritChat", "draftPost", "advancedDiagnosis"]
          },
          "body": { "type": "string", "maxLength": 8000 },
          "notes": { "type": "string", "maxLength": 500 },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

### app.aozoraquest.config.maintenance

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.config.maintenance",
  "defs": {
    "main": {
      "type": "record",
      "description": "Maintenance mode state",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["enabled", "updatedAt"],
        "properties": {
          "enabled": { "type": "boolean" },
          "message": { "type": "string", "maxLength": 500 },
          "until": { "type": "string", "format": "datetime" },
          "allowedDids": {
            "type": "array",
            "items": { "type": "string", "format": "did" }
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

### app.aozoraquest.directory

共鳴タイムライン (05-compatibility.md) のための、オプトイン済みユーザー DID のリスト。主管理者 PDS に置かれ、全クライアント が読み取って発見元にする。

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.directory",
  "defs": {
    "main": {
      "type": "record",
      "description": "Directory of Aozora Quest users who opted in to be discoverable",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["users", "updatedAt"],
        "properties": {
          "users": {
            "type": "array",
            "items": { "type": "ref", "ref": "#entry" }
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    },
    "entry": {
      "type": "object",
      "required": ["did", "addedAt"],
      "properties": {
        "did": { "type": "string", "format": "did" },
        "addedAt": { "type": "string", "format": "datetime" },
        "note": { "type": "string", "maxLength": 200 }
      }
    }
  }
}
```

ユーザー側の前提: `app.aozoraquest.profile.discoverable = true` かつ `app.aozoraquest.analysis.public = true` を設定したユーザーのみが、主管理者によってこのディレクトリに追加される。

### app.aozoraquest.config.bans

```json
{
  "lexicon": 1,
  "id": "app.aozoraquest.config.bans",
  "defs": {
    "main": {
      "type": "record",
      "description": "DIDs to hide from timelines",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["dids", "updatedAt"],
        "properties": {
          "dids": {
            "type": "array",
            "items": { "type": "string", "format": "did" }
          },
          "notes": {
            "type": "unknown",
            "description": "Optional map of did to note string"
          },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

## IndexedDB スキーマ (クライアントキャッシュ)

PDS がデータの正本だが、パフォーマンスのためにクライアントにもキャッシュを持つ。

### オブジェクトストア

```typescript
interface AozoraDB {
  // 埋め込みモデルのバイナリ (130MB)
  modelCache: {
    key: string; // e.g., 'e5-small-q8'
    data: ArrayBuffer;
    cachedAt: number;
  };
  
  // プロトタイプベクトル (300KB)
  prototypes: {
    key: string; // e.g., 'cognitive.Ni', 'tag.question'
    vectors: Float32Array[]; // 25 vectors × 384 dim
    loadedAt: number;
  };
  
  // 投稿のタグキャッシュ
  postTags: {
    uri: string; // AT URI
    tags: string[];
    cachedAt: number; // TTL 24h
  };
  
  // 自分の生ステータス (減衰計算用)
  statsRaw: {
    key: 'self';
    actions: Action[]; // 過去 180 日分
    lastSyncedAt: number;
  };
  
  // 今日のクエスト
  todayQuests: {
    date: string; // YYYY-MM-DD
    quests: QuestInstance[];
    generatedAt: number;
  };
  
  // 他ユーザーのステータスキャッシュ
  partnerStats: {
    did: string;
    stats: StatVector;
    archetype: string;
    cachedAt: number; // TTL 7d
  };
  
  // ユーザー設定
  settings: {
    key: 'self';
    theme: 'light' | 'dark' | 'system';
    byokProvider?: 'anthropic' | 'openrouter';
    byokKey?: string; // AES-GCM で暗号化して保存 (09-tech-stack.md §セキュリティ)
    byokModel?: string; // プロバイダーごとに異なる識別子
                        // anthropic: 'claude-haiku-4-5-20251001' など
                        // openrouter: 'anthropic/claude-haiku-4.5' や 'openai/gpt-5' など
  };
  
  // 精霊会話セッション
  activeCompanionSession: {
    key: 'current';
    messages: Message[];
    startedAt: number;
  };
}
```

### 型定義 (TypeScript)

```typescript
type Stat = 'atk' | 'def' | 'agi' | 'int' | 'luk';
type CogFunction = 'Ni' | 'Ne' | 'Si' | 'Se' | 'Ti' | 'Te' | 'Fi' | 'Fe';
type Archetype =
  | 'sage' | 'mage' | 'shogun' | 'bard'
  | 'seer' | 'poet' | 'paladin' | 'explorer'
  | 'warrior' | 'guardian' | 'fighter' | 'artist'
  | 'captain' | 'miko' | 'ninja' | 'performer';
type NameVariant = 'default' | 'maker' | 'alt';

interface StatVector {
  atk: number;
  def: number;
  agi: number;
  int: number;
  luk: number;
}

interface CognitiveScores {
  Ni: number; Ne: number; Si: number; Se: number;
  Ti: number; Te: number; Fi: number; Fe: number;
}

interface Action {
  id: string;
  type: 'post' | 'reply' | 'quote' | 'repost' | 'like';
  postUri?: string;
  parentUri?: string;
  textLength?: number;
  weight: Partial<Record<Stat, number>>;
  tags: string[];
  at: number; // timestamp
}

interface QuestInstance {
  id: string;
  templateId: string;
  type: 'growth' | 'maintain' | 'restraint';
  targetStat: Stat;
  targetCount: number;
  actualCount: number;
  completed: boolean;
  xpReward: number;
  forbiddenActionTypes?: string[]; // 節制クエスト用
}

interface Message {
  role: 'user' | 'spirit';
  text: string;
  at: number;
}
```

## データ同期戦略

### 書き込み頻度

- `profile`: 設定変更時のみ (低頻度)
- `analysis`: 診断実行時のみ (低頻度、1 日数回以下)
- `questLog`: 日付変更時にバッチ書き込み (1 日 1 回)
- `companion`: 仲間追加時のみ
- `companionLog`: 会話セッション終了時にまとめて

合計で PDS への書き込みは 1 ユーザー 1 日 5-10 回程度。レート制限に余裕がある。

### 同期フロー

```typescript
async function syncToPDS() {
  const localData = await db.getAll();
  
  // 1. profile
  if (localData.settings.dirty) {
    await client.putRecord({
      repo: did,
      collection: 'app.aozoraquest.profile',
      rkey: 'self',
      record: {
        targetJob: localData.settings.targetJob,
        nameVariant: localData.settings.nameVariant,
        publicAnalysis: localData.settings.publicAnalysis,
        updatedAt: new Date().toISOString(),
      },
    });
  }
  
  // 2. 今日のクエストログ (日付変更時のみ)
  if (localData.yesterdayCompleted && !localData.yesterdaySynced) {
    await client.putRecord({
      repo: did,
      collection: 'app.aozoraquest.questLog',
      rkey: localData.yesterdayDate,
      record: composeQuestLog(localData.yesterdayQuests),
    });
  }
  
  // 他のレコードも同様
}
```

### 衝突解決

複数デバイスから書き込まれた場合、`updatedAt` の新しい方を採用 (LWW)。

起動時に PDS から最新を fetch し、ローカルキャッシュと比較して新しい方を採用する。ローカルが新しければ PDS へ push、PDS が新しければローカルを上書き。

### データエクスポート

ユーザーが自分のデータを全部取り出したい場合、PDS の `com.atproto.repo.listRecords` で `app.aozoraquest.*` を列挙し、JSON にまとめてダウンロード。

## バリデーション

クライアント側で書き込み前にバリデーションする。

- ステータスの合計が 100 ± 1 (丸め誤差許容)
- 認知機能スコアが 0-100 範囲内
- 日付文字列が ISO 8601 形式
- 配列の最大長を超えない (companions 100 件まで)

Zod などを使って型と制約を同時に検証すると楽。

## 将来の拡張

### スキーマ変更時の互換性

AT Protocol のレキシコンは後方互換を保ちやすい設計だが、破壊的変更が必要なら:

1. 新スキーマを `app.aozoraquest.profileV2` のようにバージョン番号付きで追加
2. 移行期間中は両方を読み取り、書き込みは新しい方へ
3. 十分な期間を置いて旧スキーマを廃止

### 追加レコード候補

- `app.aozoraquest.achievement`: 称号の履歴
- `app.aozoraquest.draft`: 投稿の下書き (クラウド同期用)
- `app.aozoraquest.wishlist`: 見習いたい人のリスト (目標ジョブ選択補助)

これらは MVP に不要。ユーザーからの要望が出てから実装する。
