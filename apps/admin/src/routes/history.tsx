export function History() {
  return (
    <div>
      <h2>変更履歴</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        主管理者 PDS のコミット履歴 (<code>com.atproto.sync.listRecords</code>) を表示。
        保存操作ごとに各レコードの差分が見える。実装中。
      </p>
      <div className="section">
        <p>ここに時系列でレコード変更が並ぶ予定。</p>
      </div>
    </div>
  );
}
