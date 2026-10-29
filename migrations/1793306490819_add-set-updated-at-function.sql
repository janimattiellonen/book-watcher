-- Up Migration

-- Maintains updated_at in the database, so every write path gets it, including
-- ad-hoc SQL. Every table with an updated_at column attaches this trigger.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();

  RETURN NEW;
END;
$$;

-- Down Migration
DROP FUNCTION set_updated_at();
