create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  true,
  8454144,
  array['application/octet-stream']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Allow public chat image uploads'
  ) then
    create policy "Allow public chat image uploads"
    on storage.objects
    for insert
    to anon, authenticated
    with check (
      bucket_id = 'chat-images'
      and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
  end if;
end $$;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
  into existing_job_id
  from cron.job
  where jobname = 'chat-image-cleanup-every-15-min';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;

  perform cron.schedule(
    'chat-image-cleanup-every-15-min',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := 'https://ousgmjyajyorywpqbdkf.supabase.co/functions/v1/chat-image-cleanup',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
    $job$
  );
end $$;
