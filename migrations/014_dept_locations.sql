-- OrbitDesk migration 011: department locations (Superpower #11 Global Operations Map).
-- Coordinates are coarse by default; exact sensitive locations stay hidden
-- from non-privileged viewers via server-side rounding (see lib/geo.ts).

ALTER TABLE departments ADD COLUMN IF NOT EXISTS location_name text;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS location_lat numeric(9,6);
ALTER TABLE departments ADD COLUMN IF NOT EXISTS location_lng numeric(9,6);
