import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import { jobDisplayName, pickSpiritLine, type SpiritSituation } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';

type GreetingSituation = 'greeting.morning' | 'greeting.daytime' | 'greeting.night';

function currentGreeting(): GreetingSituation {
  const h = new Date().getHours();
  if (h < 11) return 'greeting.morning';
  if (h < 18) return 'greeting.daytime';
  return 'greeting.night';
}

export function Spirit() {
  const session = useSession();
  const [diag, setDiag] = useState<DiagnosisResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) {
      setLoaded(true);
      return;
    }
    const agent = session.agent;
    const did = session.did;
    (async () => {
      try {
        const r = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self');
        setDiag(r);
      } catch (e) {
        console.warn('analysis load failed', e);
      } finally {
        setLoaded(true);
      }
    })();
  }, [session.status, session.agent, session.did]);

  const lines = useMemo(() => {
    if (session.status !== 'signed-in' || !session.did) return [];
    const userName = session.handle?.split('.')[0] ?? 'あなた';
    const ctx = { userName, userDid: session.did };
    const situations: SpiritSituation[] = [currentGreeting()];
    // 診断済みなら job 到達の労いを一行足す
    if (diag) situations.push('quest.complete');
    const collected: string[] = [];
    for (const s of situations) {
      const line = pickSpiritLine(s, ctx);
      if (line) collected.push(line);
    }
    return collected;
  }, [session.status, session.did, session.handle, diag]);

  if (session.status === 'loading' || !loaded) return <p>読み込み中...</p>;

  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>精霊</h2>
        <p>ログインが必要です。</p>
        <Link to="/onboarding"><button>ログイン</button></Link>
      </div>
    );
  }

  const jobLabel = diag ? jobDisplayName(diag.archetype, 'default') : null;

  return (
    <div>
      <h2>精霊</h2>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {jobLabel ? `今の姿: ${jobLabel}` : '気質を調べるともう少し深く話せるようになる。'}
      </p>

      <section style={{ marginTop: '1em', border: '1px solid var(--color-border)', borderRadius: 4, padding: '1em', display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
        {lines.length === 0 ? (
          <p style={{ color: 'var(--color-muted)' }}>(精霊は静かにそこにいる)</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} style={{ background: 'var(--color-bg-alt, rgba(0,0,0,0.04))', padding: '0.7em 0.9em', borderRadius: 8, whiteSpace: 'pre-wrap' }}>
              {line}
            </div>
          ))
        )}
      </section>

    </div>
  );
}
