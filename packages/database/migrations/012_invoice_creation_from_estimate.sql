-- Invoice creation from a signed estimate.
--
-- The prototype freezes the signed estimate into an internal invoice snapshot
-- (invoices.estimate_id + a jsonb snapshot). jbox models the same flow with its
-- native invoice rows: invoices.estimate_id records the source estimate (at most
-- one invoice per estimate, enforced by the partial unique index below), and the
-- invoice is a faithful copy of the signed estimate's header, lines, and
-- persisted totals. The estimate derives its invoiceId from invoices.estimate_id
-- (see estimates.ts HEADER_SELECT), so creating an invoice never rewrites the
-- estimate row and cannot invalidate a loaded editor's expectedUpdatedAt -- the
-- same rule the job link established in migration 011.
--
-- estimate_id stays NULL for invoices raised outside the estimate flow.

ALTER TABLE invoices
  ADD COLUMN estimate_id uuid,
  ADD CONSTRAINT invoices_estimate_id_fk
    FOREIGN KEY (estimate_id, organization_id)
    REFERENCES estimates (id, organization_id)
    ON DELETE RESTRICT;

-- migrate:split

CREATE UNIQUE INDEX IF NOT EXISTS invoices_estimate_id_uniq
  ON invoices (organization_id, estimate_id)
  WHERE estimate_id IS NOT NULL;

-- migrate:split

-- The estimate history records the freeze that created its invoice, symmetric
-- with the 'job_linked' event from 011. The CHECK was declared inline at table
-- creation, so Postgres named it estimate_events_event_check; rebuild it with
-- the wider set, keeping the original values verbatim.
ALTER TABLE estimate_events
  DROP CONSTRAINT estimate_events_event_check,
  ADD CONSTRAINT estimate_events_event_check
    CHECK (event IN
      ('created', 'updated', 'lines_changed', 'signed', 'declined', 'duplicated',
       'job_linked', 'invoice_created'));
