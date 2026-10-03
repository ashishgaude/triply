import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("directory migration backfills users, syncs changes, and enforces read-only authenticated access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema triply;
      create table public.triply_users (id text primary key, display_name text);
      insert into public.triply_users values ('other-project', 'Unchanged');
      create function public.triply_sync_user() returns text language sql as $$ select 'other-project'::text $$;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      insert into auth.users values
        ('11111111-1111-4111-8111-111111111111', 'sam@example.test', '{"full_name":"Sam"}'),
        ('22222222-2222-4222-8222-222222222222', 'jamie@example.test', '{}');
    `);
    const migration = await readFile(
      new URL(
        "../supabase/migrations/2026-10-03-traveler-directory.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(
      (await db.query("select * from public.triply_users")).rows,
      [{ id: "other-project", display_name: "Unchanged" }],
    );
    assert.equal(
      (
        await db.query<{ result: string }>(
          "select public.triply_sync_user() as result",
        )
      ).rows[0].result,
      "other-project",
    );
    const backfill = await db.query<{ display_name: string }>(
      "select display_name from triply.users order by id",
    );
    assert.deepEqual(
      backfill.rows.map((row) => row.display_name),
      ["Sam", "jamie"],
    );
    await db.exec(`
      insert into auth.users values ('33333333-3333-4333-8333-333333333333', null, '{"name":"Riley"}');
      update auth.users set raw_user_meta_data = '{"full_name":"Jamie"}' where id = '22222222-2222-4222-8222-222222222222';
    `);
    const names = await db.query<{ display_name: string }>(
      "select display_name from triply.users order by id",
    );
    assert.deepEqual(
      names.rows.map((row) => row.display_name),
      ["Sam", "Jamie", "Riley"],
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from triply.users"),
      /permission denied/,
    );
    await db.exec("reset role; set role authenticated");
    assert.equal((await db.query("select * from triply.users")).rows.length, 3);
    await assert.rejects(
      db.query("update triply.users set display_name = 'Changed'"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("delete from triply.users"),
      /permission denied/,
    );
    await assert.rejects(
      db.query(
        "insert into triply.users values ('44444444-4444-4444-8444-444444444444', 'Intruder')",
      ),
      /permission denied/,
    );
    await db.exec("reset role");
    const access = await db.query<{ can_execute: boolean }>(
      "select has_function_privilege('authenticated', 'triply.sync_user()', 'execute') as can_execute",
    );
    assert.equal(access.rows[0].can_execute, false);
    await db.exec(
      "delete from auth.users where id = '33333333-3333-4333-8333-333333333333'",
    );
    assert.equal((await db.query("select * from triply.users")).rows.length, 2);
  } finally {
    await db.close();
  }
});
