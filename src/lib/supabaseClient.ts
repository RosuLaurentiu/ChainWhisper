import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClientSingleton: SupabaseClient | null = null;
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
