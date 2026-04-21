import { type ReactNode } from 'react';
import { AdminSessionContext, useAdminSessionLoader } from '@/lib/session';

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const state = useAdminSessionLoader();
  return <AdminSessionContext.Provider value={state}>{children}</AdminSessionContext.Provider>;
}
