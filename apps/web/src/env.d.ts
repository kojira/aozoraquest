/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_URL: string;
  readonly VITE_ADMIN_DIDS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
