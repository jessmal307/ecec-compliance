-- Scheduled edge function calls. Safe to re-run: each job is unscheduled
-- (if present) and scheduled again, so cron.job never holds duplicates.
--
-- Requires two Vault secrets, created once outside this file:
--   project_url       https://<PROJECT_REF>.supabase.co (no trailing slash)
--   cron_secret_key   the sb_secret_ key named "cron" (Settings > API Keys)
-- Jobs send it on the apikey header; the functions check it against
-- SUPABASE_SECRET_KEYS['cron'].
-- Both are read from vault.decrypted_secrets when each job runs, so no key
-- or project ref is stored here or in cron.job.command.
--
-- pg_cron runs in UTC. Sydney is UTC+10 (AEST) or UTC+11 (AEDT).
--   rtc-daily-alerts    30 20 * * *  -> 06:30 AEST / 07:30 AEDT, every day
--   rtc-monthly-report  0 0 1 * *    -> 10:00 AEST / 11:00 AEDT on the 1st
--   rtc-form-overdue-alerts */15 * * * * -> every 15 minutes UTC; the
--     function exits outside 05:00–22:00 Sydney (covers AEST and AEDT)
--   rtc-purge-rate-limits 15 17 * * * -> 03:15 AEST / 04:15 AEDT, every day (SQL only)

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'rtc-daily-alerts',
  'rtc-monthly-report',
  'rtc-purge-rate-limits',
  'rtc-form-overdue-alerts',
  'send-monthly-compliance-report'
);

select cron.schedule(
  'rtc-daily-alerts',
  '30 20 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-compliance-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'rtc-monthly-report',
  '0 0 1 * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-monthly-compliance-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'rtc-form-overdue-alerts',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/send-form-overdue-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Rate limit windows are at most an hour and floor sessions last 15 minutes;
-- a day of history is plenty.
select cron.schedule(
  'rtc-purge-rate-limits',
  '15 17 * * *',
  $$
  delete from public.site_access_rate_limits
  where window_start < now() - interval '1 day';
  delete from public.floor_sessions
  where expires_at < now() - interval '1 day';
  $$
);

-- Verify (run separately): expect exactly four rows. The three rtc-* HTTP
-- jobs: reads_vault and uses_cron_key true. All four: key_or_ref_visible false.
-- select jobname, schedule, active,
--        command like '%vault.decrypted_secrets%' as reads_vault,
--        command like '%cron_secret_key%' as uses_cron_key,
--        command ~ '(sb_secret_|eyJ|\.supabase\.co)' as key_or_ref_visible
-- from cron.job order by jobname;
