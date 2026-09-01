import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { loadRuntimeConfig } from '@/lib/runtime-config';

export interface ConfigState {
  config: RuntimeConfig;
  /** 読み終えた (失敗して既定値に倒した場合も true)。 */
  loaded: boolean;
}

/** テストから状態を差し込むために公開する。本番は ConfigProvider 経由。 */
export const ConfigContext = createContext<ConfigState>({ config: DEFAULT_RUNTIME_CONFIG, loaded: false });

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(ConfigContext).config;
}

/** 読み込み完了を待ちたい画面用 (ワールドの BAN 判定など、既定値で先に描くと困るところ)。 */
export function useRuntimeConfigState(): ConfigState {
  return useContext(ConfigContext);
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
