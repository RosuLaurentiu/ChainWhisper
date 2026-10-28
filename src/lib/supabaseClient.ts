import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClientSingleton: SupabaseClient | null = null;
let supabaseWeb3AuthClientSingleton: SupabaseClient | null = null;
const DEFAULT_SUPABASE_PROJECT_URL = 'https://ousgmjyajyorywpqbdkf.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KTYvRuS5uESZNTcC16dWsA_So8HY7Jj';

export const getSupabaseUrl = (): string => {
  return import.meta.env.VITE_SUPABASE_PROJECT_URL?.trim() || DEFAULT_SUPABASE_PROJECT_URL;
};

const getSupabasePublishableKey = (): string => {
  return import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
};

export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (supabaseClientSingleton) {
    return supabaseClientSingleton;
  }

  supabaseClientSingleton = createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  return supabaseClientSingleton;
};

/**
 * Dedicated persisted Auth client for opt-in wallet services such as
 * cross-device read cursors. Keeping it separate prevents an authenticated
 * JWT from changing the behavior of the existing anonymous Edge Functions.
 */
export const getSupabaseWeb3AuthClient = (): SupabaseClient => {
  if (supabaseWeb3AuthClientSingleton) {
    return supabaseWeb3AuthClientSingleton;
  }

  supabaseWeb3AuthClientSingleton = createClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      auth: {
        storageKey: 'chainwhisper-web3-auth-v1',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );

  return supabaseWeb3AuthClientSingleton;
};
