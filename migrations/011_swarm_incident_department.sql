-- 009: Swarm / incident additions for Superpowers #5, #22, #23.
-- Additive only; safe to run on existing databases.

-- incidents.department_id was missing from 008 (needed for commander
-- suggestion + stakeholder lists in auto-command).
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS department_id integer
    REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS incidents_department
  ON incidents(department_id) WHERE deleted_at IS NULL;

-- Allow resolving an incident directly from its swarm room.
-- (room resolve flow updates incidents + swarm_rooms in one transaction.)
