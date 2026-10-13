-- Schema rules that every migration must keep. Each test lists the offenders, so a failure says
-- exactly what to fix. Run with `npm run db:test`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1),
  '{}'::text[], 'every public table has row level security enabled');

select is(
  array(select distinct table_name::text from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon' order by 1),
  '{}'::text[], 'anon has no privileges on public tables');

select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (has_function_privilege('anon', p.oid, 'execute')
               or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                          where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        order by 1),
  '{}'::text[], 'no public function is executable by anon or PUBLIC');

select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
        order by 1),
  '{}'::text[], 'every SECURITY DEFINER function pins search_path');

-- A foreign key without an index on its columns makes joins and cascading deletes scan the table.
select is(
  array(select format('%s(%s)', c.conrelid::regclass, c.conkey)
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f' and n.nspname = 'public'
          and not exists (select 1 from pg_index i
                          where i.indrelid = c.conrelid
                            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)
        order by 1),
  '{}'::text[], 'every foreign key is covered by an index');

select is(
  array(select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not exists (select 1 from pg_policy pol where pol.polrelid = c.oid)
        order by 1),
  '{}'::text[], 'every public table has at least one policy (RLS without policies hides it from everyone)');

select * from finish();
rollback;
