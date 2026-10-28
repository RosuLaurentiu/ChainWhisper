/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAINWHISPER_DEX_APP_CANDIDATE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_SUPABASE_PROJECT_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CHAT_READ_CURSOR_CLOUD_SYNC_ENABLED?: string;
  readonly VITE_CARBON_MARKET_API_BASE_URL?: string;
  readonly VITE_CHAINWHISPER_SUCCESSOR_DEX_ENABLED?: string;
  readonly VITE_CHAINWHISPER_SUCCESSOR_DEX_FINALITY_LAG_BLOCKS?: string;
  readonly VITE_CHAINWHISPER_SUCCESSOR_DEX_MANIFEST_URL?: string;
  readonly VITE_CHAINWHISPER_SUCCESSOR_DEX_RELEASE_IDENTITY_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
