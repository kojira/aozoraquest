/** モンスターが 0 体 (管理者 PDS の world.monsters が未読込) のとき、模擬戦の代わりに出す説明 (D-MONSTER-001)。 */
export function MonstersNotLoaded({ title }: { title: string }) {
  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>{title}</h3>
      <p role="status" style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        モンスター未読込: world.monsters のレコードが読み込まれていないため、模擬戦はできない (ワールド画面を開くと読み込まれる)。
      </p>
    </section>
  );
}
