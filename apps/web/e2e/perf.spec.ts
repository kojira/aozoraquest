import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PC ブラウザでの主要シナリオの計測。
 *
 * 計測:
 *  - Navigation Timing (TTFB / DOMContentLoaded / load)
 *  - Paint Timing (FCP / LCP)
 *  - Long Tasks (50ms 超のメイン threadブロック)
 *  - Resources (主要 .js / .wasm / API レスポンスのサイズ + 時間)
 *
 * 認証が要らない範囲 (landing / onboarding / tos / privacy) のみ計測。
 * 認証必須のページ (home TL / spirit / me/card) はログインフローを test に
 * 組み込んだ後で別途追加する。
 *
 * 実行例:
 *   PERF_TARGET=https://aozoraquest.app pnpm exec playwright test e2e/perf.spec.ts
 *   (省略時は preview サーバー http://127.0.0.1:4173 を使う)
 */
const TARGET = process.env.PERF_TARGET || '';

interface PageMetrics {
  url: string;
  navigation: {
    ttfb_ms: number;
    domContentLoaded_ms: number;
    load_ms: number;
    transferSize_bytes: number;
  };
  paint: {
    firstPaint_ms: number;
    firstContentfulPaint_ms: number;
    largestContentfulPaint_ms: number;
  };
  longTasks: { duration_ms: number; startTime_ms: number }[];
  resourceSummary: {
    totalCount: number;
    totalTransferSize_bytes: number;
    js: { count: number; size_bytes: number };
    css: { count: number; size_bytes: number };
    wasm: { count: number; size_bytes: number };
    img: { count: number; size_bytes: number };
    other: { count: number; size_bytes: number };
  };
  topResources: { name: string; type: string; transferSize_bytes: number; duration_ms: number }[];
}

async function measurePage(page: import('@playwright/test').Page, url: string): Promise<PageMetrics> {
  // long task 観測用フックを navigate 前に注入
  await page.addInitScript(() => {
    (window as any).__longTasks = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as any).__longTasks.push({
            duration_ms: entry.duration,
            startTime_ms: entry.startTime,
          });
        }
      });
      obs.observe({ type: 'longtask', buffered: true });
      // LCP も buffered で取る
      (window as any).__lcp = 0;
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) (window as any).__lcp = last.startTime;
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // unsupported environment
    }
  });

  await page.goto(url, { waitUntil: 'load' });
  // LCP は load 後にもまだ更新されるので少し待つ
  await page.waitForTimeout(2000);

  return await page.evaluate((pageUrl) => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paints = performance.getEntriesByType('paint') as PerformancePaintTiming[];
    const fp = paints.find((p) => p.name === 'first-paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');

    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const summary = {
      totalCount: resources.length,
      totalTransferSize_bytes: 0,
      js: { count: 0, size_bytes: 0 },
      css: { count: 0, size_bytes: 0 },
      wasm: { count: 0, size_bytes: 0 },
      img: { count: 0, size_bytes: 0 },
      other: { count: 0, size_bytes: 0 },
    };
    for (const r of resources) {
      const size = r.transferSize || 0;
      summary.totalTransferSize_bytes += size;
      const url = r.name;
      if (/\.m?js(\?|$)/.test(url) || r.initiatorType === 'script') {
        summary.js.count++; summary.js.size_bytes += size;
      } else if (/\.css(\?|$)/.test(url) || r.initiatorType === 'link' && /\.css/.test(url)) {
        summary.css.count++; summary.css.size_bytes += size;
      } else if (/\.wasm(\?|$)/.test(url)) {
        summary.wasm.count++; summary.wasm.size_bytes += size;
      } else if (r.initiatorType === 'img' || /\.(png|jpe?g|webp|gif|svg)(\?|$)/.test(url)) {
        summary.img.count++; summary.img.size_bytes += size;
      } else {
        summary.other.count++; summary.other.size_bytes += size;
      }
    }
    // 上位 10 リソース (転送サイズ降順)
    const top = [...resources]
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 10)
      .map((r) => ({
        name: r.name.replace(location.origin, ''),
        type: r.initiatorType,
        transferSize_bytes: r.transferSize || 0,
        duration_ms: Math.round(r.duration),
      }));

    return {
      url: pageUrl,
      navigation: {
        ttfb_ms: nav ? Math.round(nav.responseStart - nav.requestStart) : -1,
        domContentLoaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : -1,
        load_ms: nav ? Math.round(nav.loadEventEnd - nav.startTime) : -1,
        transferSize_bytes: nav?.transferSize ?? 0,
      },
      paint: {
        firstPaint_ms: fp ? Math.round(fp.startTime) : -1,
        firstContentfulPaint_ms: fcp ? Math.round(fcp.startTime) : -1,
        largestContentfulPaint_ms: Math.round((window as any).__lcp ?? 0),
      },
      longTasks: ((window as any).__longTasks ?? []).map((t: any) => ({
        duration_ms: Math.round(t.duration_ms),
        startTime_ms: Math.round(t.startTime_ms),
      })),
      resourceSummary: summary,
      topResources: top,
    } as PageMetrics;
  }, url);
}

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function printMetrics(label: string, m: PageMetrics) {
  console.log(`\n=== ${label} (${m.url}) ===`);
  console.log(`  TTFB:                  ${m.navigation.ttfb_ms} ms`);
  console.log(`  DOMContentLoaded:      ${m.navigation.domContentLoaded_ms} ms`);
  console.log(`  load event:            ${m.navigation.load_ms} ms`);
  console.log(`  First Paint:           ${m.paint.firstPaint_ms} ms`);
  console.log(`  First Contentful Paint:${m.paint.firstContentfulPaint_ms} ms`);
  console.log(`  Largest Contentful Paint: ${m.paint.largestContentfulPaint_ms} ms`);
  console.log(`  Resource total: ${m.resourceSummary.totalCount} files, ${fmtKB(m.resourceSummary.totalTransferSize_bytes)}`);
  console.log(`    js:   ${m.resourceSummary.js.count} (${fmtKB(m.resourceSummary.js.size_bytes)})`);
  console.log(`    css:  ${m.resourceSummary.css.count} (${fmtKB(m.resourceSummary.css.size_bytes)})`);
  console.log(`    wasm: ${m.resourceSummary.wasm.count} (${fmtKB(m.resourceSummary.wasm.size_bytes)})`);
  console.log(`    img:  ${m.resourceSummary.img.count} (${fmtKB(m.resourceSummary.img.size_bytes)})`);
  console.log(`    other:${m.resourceSummary.other.count} (${fmtKB(m.resourceSummary.other.size_bytes)})`);
  if (m.longTasks.length > 0) {
    const total = m.longTasks.reduce((a, t) => a + t.duration_ms, 0);
    const max = Math.max(...m.longTasks.map((t) => t.duration_ms));
    console.log(`  Long Tasks (>50ms): ${m.longTasks.length} 件、合計 ${total} ms、最大 ${max} ms`);
  } else {
    console.log(`  Long Tasks: 0`);
  }
  console.log(`  Top resources:`);
  for (const r of m.topResources) {
    console.log(`    - ${fmtKB(r.transferSize_bytes).padStart(10)}  ${r.duration_ms.toString().padStart(5)}ms  ${r.name}`);
  }
}

test.describe('PC ブラウザの主要シナリオ計測', () => {
  test('cold load to root + 静的ルート遷移', async ({ page }) => {
    const baseUrl = TARGET || page.context()._options.baseURL || 'http://127.0.0.1:4173';
    const results: { label: string; metrics: PageMetrics }[] = [];

    // 1. cold load: トップ
    const root = await measurePage(page, `${baseUrl}/?cb=${Date.now()}`);
    printMetrics('cold load /', root);
    results.push({ label: 'cold-load-root', metrics: root });

    // 2. /onboarding (認証未要)
    const onboarding = await measurePage(page, `${baseUrl}/onboarding`);
    printMetrics('navigate /onboarding', onboarding);
    results.push({ label: 'onboarding', metrics: onboarding });

    // 3. /tos
    const tos = await measurePage(page, `${baseUrl}/tos`);
    printMetrics('navigate /tos', tos);
    results.push({ label: 'tos', metrics: tos });

    // 4. /privacy
    const privacy = await measurePage(page, `${baseUrl}/privacy`);
    printMetrics('navigate /privacy', privacy);
    results.push({ label: 'privacy', metrics: privacy });

    // JSON dump
    const dir = join(process.cwd(), 'test-results');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'perf-report.json');
    writeFileSync(path, JSON.stringify({
      target: baseUrl,
      measuredAt: new Date().toISOString(),
      results,
    }, null, 2));
    console.log(`\nperf レポート保存: ${path}`);
  });
});
