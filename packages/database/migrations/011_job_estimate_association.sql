-- Job ⇄ estimate association.
--
-- The prototype links a job to an estimate by writing estimate.job_id. jbox
-- models the same edge from the other side: jobs.estimate_id, and the estimate
-- record derives its jobId from jobs.estimate_id (see estimates.ts
-- HEADER_SELECT). Association is therefore "at most one job per estimate"; the
-- partial unique index below is that contract, and it also makes the linked
-- lookup total (a job can never name a second estimate, so the derived jobId is
-- never ambiguous).
--
-- The two event vocabularies are extended so both histories record the link
-- instead of it passing silently. These CHECKs were declared inline at table
-- creation, so Postgres named them <table>_event_check; we rebuild them with
-- the wider set. Keep the original values verbatim.

ALTER TABLE job_events
  DROP CONSTRAINT job_events_event_check,
  ADD CONSTRAINT job_events_event_check
    CHECK (event IN
      ('created', 'status_changed', 'scheduled', 'note_added', 'materials_added',
       'completed', 'cancelled', 'estimate_linked'));

-- migrate:split

ALTER TABLE estimate_events
  DROP CONSTRAINT estimate_events_event_check,
  ADD CONSTRAINT estimate_events_event_check
    CHECK (event IN
      ('created', 'updated', 'lines_changed', 'signed', 'declined', 'duplicated',
       'job_linked'));

-- migrate:split

-- At most one job per estimate. estimate_id stays NULL for unlinked jobs.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_estimate_id_uniq
  ON jobs (organization_id, estimate_id)
  WHERE estimate_id IS NOT NULL;
