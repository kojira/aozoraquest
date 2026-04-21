import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { loadRuntimeConfig } from '@/lib/runtime-config';

interface ConfigState {
  config: RuntimeConfig;
  loaded: boolean;
}

const ConfigContext = createContext<ConfigState>({ config: DEFAULT_RUNTIME_CONFIG, loaded: false });

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(ConfigContext).config;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigState>({ config: DEFAULT_RUNTIME_CONFIG, loaded: false });

  useEffect(() => {
    loadRuntimeConfig()
      .then((config) => setState({ config, loaded: true }))
      .catch((e) => {
        console.error('runtime config load failed', e);
        setState({ config: DEFAULT_RUNTIME_CONFIG, loaded: true });
      });
  }, []);

  return <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>;
}
