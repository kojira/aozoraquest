import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult } from '@aozoraquest/core';
import { jobDisplayName, pickSpiritLine, type SpiritSituation } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getRecord } from '@/lib/atproto';
import { SpiritIcon } from '@/components/spirit-icon';
import { SpiritBubble } from '@/components/spirit-bubble';

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
    if (diag) situations.push('quest.complete');
    const collected: string[] = [];
    for (const s of situations) {
      const line = pickSpiritLine(s, ctx);
      if (line) collected.push(line);
    }
    return collected;
  }, [session.status, session.did, session.handle, diag]);

  if (session.status === 'loading' || !loaded) {
    return (
      <div>
        <h2>精霊ブルスコン</h2>
        <SpiritBubble sleeping>…</SpiritBubble>
      </div>
    );
  }

  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>精霊ブルスコン</h2>
        <SpiritBubble>ログインすると、わたしの声が届きます。</SpiritBubble>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログイン</button></Link>
      </div>
    );
  }

  const jobLabel = diag ? jobDisplayName(diag.archetype, 'default') : null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: '0.2em' }}>
        <SpiritIcon size={56} />
        <div>
          <h2 style={{ margin: 0 }}>精霊ブルスコン</h2>
          <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
            {jobLabel ? `あなたは今「${jobLabel}」の姿` : '気質を調べるともう少し深く話せる'}
          </p>
        </div>
      </div>

      <section style={{ marginTop: '1em', display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
        {lines.length === 0 ? (
          <SpiritBubble sleeping>…今はそっとしておくね。</SpiritBubble>
        ) : (
          lines.map((line, i) => <SpiritBubble key={i}>{line}</SpiritBubble>)
        )}
      </section>
    </div>
  );
}
