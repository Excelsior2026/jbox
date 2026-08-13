-- Native-auth users have no Clerk id; clerk_user_id must be nullable.
-- 005 declared it NOT NULL for the Clerk-sync era; 007's provision_staff_member
-- inserts without it. Guarded so the change is re-runnable by the tools that
-- build review databases.
ALTER TABLE platform_users ALTER COLUMN clerk_user_id DROP NOT NULL;
