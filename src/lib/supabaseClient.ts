import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClientSingleton: SupabaseClient | null = null;

export const getSupabaseUrl = (): string => {
  const configured = import.meta.env.VITE_SUPABASE_PROJECT_URL?.trim() ?? '';
  if (!configured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_PROJECT_URL.');
  }

  return configured;
};

const getSupabasePublishableKey = (): string => {
  const configured = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!configured) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  return configured;
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
