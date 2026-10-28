-- GRANT does not remove permissions inherited from Supabase's default grants.
revoke all on table public.app_help_rate_limits from service_role;
grant select, insert, update on table public.app_help_rate_limits to service_role;

revoke all on function public.reject_legacy_chat_image_confirmation()
  from public, anon, authenticated;
