/**
 * AT Protocol リッチテキスト facet の最小型 (app.bsky.richtext.facet)。
 * 描画側 (components/post-text) と埋め込み抽出側 (lib/post-embed) の双方が参照するため、
 * どちらにも依存しない leaf モジュールに置く (lib → components の逆流依存を避ける)。
 */

export interface FacetFeature {
  $type?: string;
  uri?: string;
  did?: string;
  tag?: string;
}

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features?: FacetFeature[];
}
