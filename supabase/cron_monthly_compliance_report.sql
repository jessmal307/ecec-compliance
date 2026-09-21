-- Monthly provider compliance report.
-- Midnight on the 1st, Australia/Sydney:
--   00:00 AEST (UTC+10) = 14:00 UTC on the 1st
--   00:00 AEDT (UTC+11) = 13:00 UTC on the 1st
-- pg_cron is UTC, so this job uses 14:00 UTC on day 1.
--
-- Enable pg_cron and pg_net, replace PROJECT_REF and SERVICE_ROLE_KEY,
-- then run this in the SQL editor.

select cron.unschedule(jobid)
from cron.job
where jobname = 'send-monthly-compliance-report';

select cron.schedule(
  'send-monthly-compliance-report',
  '0 14 1 * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/send-monthly-compliance-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
