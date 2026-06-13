/**
 * AppColumn → URL の変換 (docs/16-multicolumn.md)。
 *
 * 「このカラムへの直リンク」シェア用。カラムの中身は従来 route として
 * URL を持っているので、そこへ誘導する。
 *
 * 逆方向 (URL → AppColumn) は現状消費者がいないため実装しない
 * (必要になった時点で columnFromUrl を追加する)。
 */
import type { AppColumn } from './app-columns';

export function urlForColumn(c: AppColumn): string {
  switch (c.kind) {
    case 'home':          return '/';
    case 'bar':           return '/';
    case 'notifications': return '/notifications';
    case 'search': {
      if (!c.param) return '/search';
      const params = new URLSearchParams({ q: c.param });
      if (c.mode === 'posts') params.set('mode', 'posts');
      return `/search?${params.toString()}`;
    }
    case 'board':         return '/board';
    case 'profile':       return c.param ? `/profile/${encodeURIComponent(c.param)}` : '/me';
  }
}
