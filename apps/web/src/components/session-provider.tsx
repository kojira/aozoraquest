import type { ReactNode } from 'react';
import { SessionContext, useSessionLoader } from '@/lib/session';

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSessionLoader();
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
