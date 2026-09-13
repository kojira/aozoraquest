import type { ScenarioEvent } from './scenario.js';

/** 報告でだけ次の依頼を解禁する。最初の受注はflag待ちにしない。 */
export function starterTownScenario(): ScenarioEvent[] {
  return [
  {
    "id": "futaba-after-slimes",
    "title": "スライムから 村をまもろう",
    "when": [
      {
        "kind": "questDone",
        "questId": "futaba-slimes"
      }
    ],
    "setFlags": [
      "futaba_slimes_done"
    ]
  },
  {
    "id": "futaba-after-herbs",
    "title": "やどやの やくそう",
    "when": [
      {
        "kind": "questDone",
        "questId": "futaba-herbs"
      }
    ],
    "setFlags": [
      "futaba_herbs_done"
    ]
  },
  {
    "id": "futaba-after-wings",
    "title": "たびじたくの おてつだい",
    "when": [
      {
        "kind": "questDone",
        "questId": "futaba-wings"
      }
    ],
    "setFlags": [
      "futaba_wings_done"
    ]
  }
];
}
