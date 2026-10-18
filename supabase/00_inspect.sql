-- Network Watch: step 1. READ-ONLY. Run this first in the Supabase SQL editor and check the output.
-- It lists every table and column in the public schema so you can confirm nothing clashes with the
-- new nw_* tables before running schema.sql. It changes nothing.
select t.table_name, c.column_name, c.data_type, c.is_nullable
from information_schema.tables t
join information_schema.columns c on c.table_schema = t.table_schema and c.table_name = t.table_name
where t.table_schema = 'public'
order by t.table_name, c.ordinal_position;

-- Any existing Network Watch tables? (empty result = safe to run schema.sql as is)
select table_name from information_schema.tables where table_schema = 'public' and table_name like 'nw\_%';
