-- Scheduled edge function calls. Safe to re-run: each job is unscheduled
-- (if present) and scheduled again, so cron.job never holds duplicates.
--
-- Requires two Vault secrets, created once outside this file:
--   project_url       https://<PROJECT_REF>.supabase.co (no trailing slash)
--   service_role_key  legacy service_role JWT (must equal SUPABASE_SERVICE_ROLE_KEY)
-- Both are read from vault.decrypted_secrets when each job runs, so no key
-- or project ref is stored here or in cron.job.command.
--
-- pg_cron runs in UTC. Sydney is UTC+10 (AEST) or UTC+11 (AEDT).
--   rtc-daily-alerts    30 20 * * *  -> 06:30 AEST / 07:30 AEDT, every day
--   rtc-monthly-report  0 0 1 * *    -> 10:00 AEST / 11:00 AEDT on the 1st

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'rtc-daily-alerts',
  'rtc-monthly-report',
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
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
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
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
