-- 016_it_service_management.sql: DEJOIY IT (it.dejoiy.com) on the OrbitDesk backend.
-- Additive only. Mirrored in server/lib/schema-patches.ts so a fresh deploy works
-- before a super admin runs migrations.

-- Catalog: services vs items, presentation and fulfilment templates.
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service';
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS group_name text NOT NULL DEFAULT 'General';
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'box';
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT '';
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;
ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS fulfilment_tasks jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Fulfilment checklist per request (copied from the item's template on submit).
CREATE TABLE IF NOT EXISTS it_request_tasks (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES service_catalog_requests(id) ON DELETE CASCADE,
  title text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  done_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS it_request_tasks_request ON it_request_tasks(request_id, sort_order);

-- Assets live in configuration_items (ci_type laptop|desktop|monitor|headset|phone|licence|...);
-- the assigned person is owner_id. Index the hardware view.
CREATE INDEX IF NOT EXISTS ci_owner ON configuration_items(owner_id) WHERE deleted_at IS NULL;
