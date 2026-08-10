-- 006_estimate_customer_snapshot.sql
--
-- A signed estimate is a contract: the document a customer accepted must render
-- identically to what was hashed into content_hash at signing
-- (docs/architecture/foundation-decisions.md §1). estimates FK to the mutable
-- customers directory, so the customer details a signed document displays can
-- only be frozen by copying them here, at signing time, into this snapshot.
--
-- Drafts may carry no snapshot (NULL); signing writes all five columns in the
-- same UPDATE that sets status/content_hash/signed_at, and the CHECK below makes
-- a signed estimate without a snapshot impossible.

ALTER TABLE estimates
  ADD COLUMN customer_name text
    CHECK (customer_name IS NULL OR char_length(customer_name) BETWEEN 2 AND 200),
  ADD COLUMN customer_phone text
    CHECK (customer_phone IS NULL OR char_length(customer_phone) BETWEEN 1 AND 40),
  ADD COLUMN customer_email text
    CHECK (customer_email IS NULL OR char_length(customer_email) BETWEEN 3 AND 320),
  ADD COLUMN customer_address text
    CHECK (customer_address IS NULL OR char_length(customer_address) <= 200),
  ADD COLUMN customer_town text
    CHECK (customer_town IS NULL OR char_length(customer_town) <= 100);

-- migrate:split

-- The snapshot is evidence of the signed contract, not decoration: a signed
-- estimate must carry the customer details it was accepted under.
ALTER TABLE estimates
  ADD CONSTRAINT estimates_signed_has_customer_snapshot
    CHECK (status <> 'signed' OR customer_name IS NOT NULL);
