/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_SUPABASE_PROJECT_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
