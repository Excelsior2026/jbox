-- 010_estimate_estimator_fields.sql
--
-- Estimator port (docs/ESTIMATOR_PORT_PLAN.md): the fields the catalog-driven
-- estimator and customer presentation need that migration 002 did not define.
--
--   estimates.areas             jsonb   room-by-room breakdown the estimator
--                                       collects; a row of work items per room
--   estimates.signature_context text    which signature flow produced a signature
--                                       (e.g. 'protected-published')
--   estimates.signature_image   text    data-URL PNG of the captured signature,
--                                       captured in the field estimator
--   estimate_line_items.area_id text    which estimator room a line belongs to
--   estimate_line_items.price_origin    provenance: was the price drawn from a
--                                       published release, typed by a technician,
--                                       or an unverified/offline starter value?
--   estimate_line_items.catalog_item_id  the catalog item a line came from
--   estimate_line_items.release_id       the published release the item version
--                                       was read from (provenance chain)
--
-- The estimate <-> job association is NOT duplicated here: migration 004 already
-- models it as jobs.estimate_id -> estimates. The record exposes `jobId` by
-- reading jobs back from that side.
--
-- RLS is already enabled and forced on estimates / estimate_line_items by
-- migration 002; added columns inherit it, and the table-level grants from 002
-- cover the new columns too.

-- migrate:split

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS areas jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(areas) = 'array');

-- migrate:split

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS signature_context text
    CHECK (signature_context IS NULL OR signature_context IN ('protected-published'));

-- migrate:split

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS signature_image text
    CHECK (signature_image IS NULL OR char_length(signature_image) <= 262144);

-- migrate:split

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS area_id text
    CHECK (area_id IS NULL OR char_length(area_id) <= 100);

-- migrate:split

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS price_origin text NOT NULL DEFAULT 'unverified'
    CHECK (price_origin IN ('published-price-book', 'technician-custom', 'unverified'));

-- migrate:split

-- A line that claims to be priced from the published book must actually carry
-- the item version reference that made it so; the trigger from 004 keeps that
-- version pointing at a PUBLISHED release. Custom and unverified lines carry no
-- version reference, which the 004 trigger allows by construction.
ALTER TABLE estimate_line_items
  ADD CONSTRAINT estimate_line_items_price_origin_requires_version
  CHECK (price_origin <> 'published-price-book' OR item_version_id IS NOT NULL);

-- migrate:split

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS catalog_item_id uuid;

-- migrate:split

ALTER TABLE estimate_line_items
  ADD COLUMN IF NOT EXISTS release_id uuid;

-- migrate:split

ALTER TABLE estimate_line_items
  ADD CONSTRAINT estimate_line_items_catalog_item_fk
  FOREIGN KEY (catalog_item_id, organization_id)
  REFERENCES price_book_items (id, organization_id) ON DELETE SET NULL;

-- migrate:split

ALTER TABLE estimate_line_items
  ADD CONSTRAINT estimate_line_items_release_fk
  FOREIGN KEY (release_id, organization_id)
  REFERENCES price_book_releases (id, organization_id) ON DELETE SET NULL;
