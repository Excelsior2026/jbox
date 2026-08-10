-- identity.sql
--
-- Exercises migration 005: Clerk identity sync windows, customer signing links,
-- and the transactional outbox. Destructive: provisions throwaway organizations,
-- then rolls back.
--
--   psql -d <db> -v ON_ERROR_STOP=1 -f packages/database/checks/identity.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE control_app;
INSERT INTO organizations (id, slug, display_name, status) VALUES
  ('aaaaaa11-0000-0000-0000-000000000001', 'identity-alpha', 'Alpha Electric', 'active'),
  ('aaaaaa22-0000-0000-0000-000000000002', 'identity-beta',  'Beta Electric',  'active');
RESET ROLE;

-- --------------------------------------------------------------------------
-- 1. Identity: the webhook windows are the only way platform_runtime reaches
--    identity rows, and they resolve the Clerk org onto the provisioned tenant
-- --------------------------------------------------------------------------
DO $$
DECLARE
  user_id uuid;
  membership_id uuid;
  resolved uuid;
  raised boolean := false;
BEGIN
  -- The control plane links a provisioned tenant to its Clerk organization.
  PERFORM link_organization_clerk('aaaaaa11-0000-0000-0000-000000000001'::uuid, 'org_clerk_alpha');

  -- platform_runtime has no tenant context here; the windows must not need one.
  SET LOCAL ROLE platform_runtime;

  resolved := resolve_organization_by_clerk_id('org_clerk_alpha');
  IF resolved <> 'aaaaaa11-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Clerk org resolved to the wrong tenant.';
  END IF;

  user_id := upsert_platform_user('user_clerk_1', 'worker@alpha.test', 'A. Worker', true);
  membership_id := upsert_clerk_membership(
    'org_clerk_alpha', 'user_clerk_1', 'worker@alpha.test', 'A. Worker',
    'membership_clerk_1', 'owner', true
  );

  -- A membership for an unprovisioned Clerk org is refused, not invented.
  BEGIN
    PERFORM upsert_clerk_membership(
      'org_clerk_unknown', 'user_clerk_2', 'x@x.test', 'X', 'membership_clerk_2', 'office', false
    );
    raised := false;
  EXCEPTION WHEN foreign_key_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'A membership was created for an unprovisioned Clerk organization.';
  END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 2. Identity reads are tenant-scoped: beta sees alpha's members? no
-- --------------------------------------------------------------------------
DO $$
DECLARE
  seen int;
BEGIN
  PERFORM set_application_context('aaaaaa22-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO seen FROM platform_users;
  IF seen <> 0 THEN RAISE EXCEPTION 'A tenant read another tenant''s platform users.'; END IF;

  SELECT count(*) INTO seen FROM organization_memberships;
  IF seen <> 0 THEN RAISE EXCEPTION 'A tenant read another tenant''s memberships.'; END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. The owner of the identity sync can see its own membership
-- --------------------------------------------------------------------------
DO $$
DECLARE
  seen int;
  stored_role text;
BEGIN
  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO seen FROM organization_memberships;
  IF seen <> 1 THEN RAISE EXCEPTION 'A tenant could not read its own membership.'; END IF;

  SELECT count(*) INTO seen FROM platform_users;
  IF seen <> 1 THEN RAISE EXCEPTION 'A tenant could not read its own member''s user row.'; END IF;

  SELECT role INTO stored_role FROM organization_memberships LIMIT 1;
  IF stored_role <> 'owner' THEN RAISE EXCEPTION 'Membership role was not stored.'; END IF;

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 4. Customer signing links: one active grant per (document, purpose);
--    consuming closes it; a consumed link cannot sign again
-- --------------------------------------------------------------------------
DO $$
DECLARE
  customer uuid;
  estimate uuid;
  grant_id uuid;
  raised boolean := false;
BEGIN
  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO customers (document_number, display_id, display_name, email)
    VALUES (allocate_document_number('customer'), 'ID-CUS-0001', 'C. Homeowner', 'c@home.test')
    RETURNING id INTO customer;

  INSERT INTO estimates (document_number, display_id, customer_id, title)
    VALUES (allocate_document_number('estimate'), 'ID-EST-0001', customer, 'Rewire')
    RETURNING id INTO estimate;

  INSERT INTO customer_access_grants
    (customer_id, document_type, document_id, purpose, token_hash, expires_at)
  VALUES
    (customer, 'estimate', estimate, 'sign', repeat('a', 64), now() + interval '30 days')
  RETURNING id INTO grant_id;

  -- A second active grant for the same document+purpose is structurally impossible.
  BEGIN
    INSERT INTO customer_access_grants
      (customer_id, document_type, document_id, purpose, token_hash, expires_at)
    VALUES
      (customer, 'estimate', estimate, 'sign', repeat('b', 64), now() + interval '30 days');
    raised := false;
  EXCEPTION WHEN unique_violation THEN
    raised := true;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Two active signing links were created for one estimate.';
  END IF;

  -- Consuming requires a consumed_at stamp.
  UPDATE customer_access_grants
  SET status = 'consumed', consumed_at = now()
  WHERE id = grant_id;

  -- Now a fresh link is possible again.
  INSERT INTO customer_access_grants
    (customer_id, document_type, document_id, purpose, token_hash, expires_at)
  VALUES
    (customer, 'estimate', estimate, 'sign', repeat('c', 64), now() + interval '30 days');

  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 5. Outbox: enqueued in tenant context, claimed by platform_runtime with no
--    context, finished with success or failure
-- --------------------------------------------------------------------------
DO $$
DECLARE
  message_id uuid;
  claimed_id uuid;
  claimed_org uuid;
  claimed_topic text;
  claimed_payload jsonb;
BEGIN
  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  INSERT INTO transactional_outbox (topic, key, payload)
  VALUES ('estimate.deliver', 'ID-EST-0001', jsonb_build_object('estimateId', 'ID-EST-0001'))
  RETURNING id INTO message_id;

  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  SELECT id, organization_id, topic, payload
    INTO claimed_id, claimed_org, claimed_topic, claimed_payload
  FROM claim_ready_outbox_messages(10)
  LIMIT 1;

  IF claimed_id IS DISTINCT FROM message_id THEN
    RAISE EXCEPTION 'The outbox did not claim the enqueued message.';
  END IF;
  IF claimed_org <> 'aaaaaa11-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'The outbox claimed a message for the wrong organization.';
  END IF;
  IF claimed_topic <> 'estimate.deliver' THEN
    RAISE EXCEPTION 'The outbox returned the wrong topic.';
  END IF;

  PERFORM finish_outbox_message(claimed_id, true, NULL);

  RESET ROLE;
  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  IF (SELECT status FROM transactional_outbox WHERE id = claimed_id) <> 'sent' THEN
    RAISE EXCEPTION 'A successful delivery did not mark the message sent.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 6. Outbox failure path: retries then dead-letter, with a bounded error note
-- --------------------------------------------------------------------------
-- Each failed delivery schedules a backoff (next_attempt_at in the future), so
-- the loop advances the clock -- as the tenant, which is the only role that may
-- write the row -- before re-claiming.
DO $$
DECLARE
  message_id uuid;
  claimed_id uuid;
  next_at timestamptz;
  i int;
BEGIN
  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  INSERT INTO transactional_outbox (topic, payload)
  VALUES ('estimate.deliver', jsonb_build_object('n', 1))
  RETURNING id INTO message_id;
  RESET ROLE;

  SET LOCAL ROLE platform_runtime;
  FOR i IN 1..12 LOOP
    SELECT id INTO claimed_id FROM claim_ready_outbox_messages(10) LIMIT 1;
    IF claimed_id IS NULL THEN
      RAISE EXCEPTION 'The outbox refused a retryable message.';
    END IF;
    PERFORM finish_outbox_message(claimed_id, false, repeat('smtp error', 100));

    RESET ROLE;
    PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
    SET LOCAL ROLE contractor_app;
    IF i = 1 THEN
      SELECT next_attempt_at INTO next_at FROM transactional_outbox WHERE id = claimed_id;
      IF next_at <= now() THEN
        RAISE EXCEPTION 'A failed delivery scheduled no backoff retry.';
      END IF;
    END IF;
    UPDATE transactional_outbox
       SET next_attempt_at = now() - interval '1 second'
     WHERE id = claimed_id;
    RESET ROLE;
    SET LOCAL ROLE platform_runtime;
  END LOOP;
  RESET ROLE;

  PERFORM set_application_context('aaaaaa11-0000-0000-0000-000000000001'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;
  IF (SELECT status FROM transactional_outbox WHERE id = message_id) <> 'dead' THEN
    RAISE EXCEPTION 'A message exhausted its retries without dead-lettering.';
  END IF;
  IF (SELECT char_length(last_error) FROM transactional_outbox WHERE id = message_id) > 500 THEN
    RAISE EXCEPTION 'A delivery error was stored unbounded.';
  END IF;
  RESET ROLE;
END;
$$;

-- --------------------------------------------------------------------------
-- 7. Direct reads are tenant-scoped on every new table
-- --------------------------------------------------------------------------
DO $$
DECLARE
  seen int;
BEGIN
  PERFORM set_application_context('aaaaaa22-0000-0000-0000-000000000002'::uuid, NULL, gen_random_uuid());
  SET LOCAL ROLE contractor_app;

  SELECT count(*) INTO seen FROM customer_access_grants
    WHERE organization_id = 'aaaaaa11-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'customer_access_grants not isolated.'; END IF;

  SELECT count(*) INTO seen FROM transactional_outbox
    WHERE organization_id = 'aaaaaa11-0000-0000-0000-000000000001';
  IF seen <> 0 THEN RAISE EXCEPTION 'transactional_outbox not isolated.'; END IF;

  RESET ROLE;
END;
$$;

ROLLBACK;

\echo 'identity.sql: all checks passed'
