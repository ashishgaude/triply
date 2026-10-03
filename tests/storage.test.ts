import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("trip storage is transactional, versioned, and limited to owners and members", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const member = "22222222-2222-4222-8222-222222222222";
  const stranger = "33333333-3333-4333-8333-333333333333";
  const tripId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const expenseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${owner}', 'owner@example.test', '{}'), ('${member}', 'member@example.test', '{}'), ('${stranger}', 'stranger@example.test', '{}');
      create table public.expenses (id integer); insert into public.expenses values (99);`);
    for (const name of [
      "2026-10-03-traveler-directory.sql",
      "2026-10-03-trip-storage.sql",
      "2026-10-03-trip-storage.sql",
    ]) {
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${name}`, import.meta.url),
          "utf8",
        ),
      );
    }
    const trip = {
      id: tripId,
      name: "Real trip",
      destination: "",
      currency: "EUR",
      members: [{ id: owner }, { id: member }],
      expenses: [
        {
          id: expenseId,
          title: "Lunch",
          amount: 101,
          payer: owner,
          category: "Food & drinks",
          date: "2026-10-03",
          participants: [owner, member],
        },
      ],
      payments: [] as {
        id: string;
        from: string;
        to: string;
        amount: number;
      }[],
    };
    const save = (value: typeof trip, version: number | null) =>
      db.query("select triply.save_trip($1::jsonb, $2::integer) as result", [
        JSON.stringify(value),
        version,
      ]);
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub = '${owner}'`,
    );
    await save(trip, null);
    const loaded = await db.query<{
      result: {
        trips: {
          id: string;
          ownerId: string;
          version: number;
          members: { id: string; name: string }[];
          expenses: { amount: number; participants: string[] }[];
        }[];
      };
    }>("select triply.get_workspace() as result");
    assert.equal(loaded.rows[0].result.trips[0].id, tripId);
    assert.equal(loaded.rows[0].result.trips[0].ownerId, owner);
    assert.equal(loaded.rows[0].result.trips[0].version, 1);
    assert.equal(loaded.rows[0].result.trips[0].members[0].name, "owner");
    assert.equal(loaded.rows[0].result.trips[0].expenses[0].amount, 101);
    assert.deepEqual(loaded.rows[0].result.trips[0].expenses[0].participants, [
      owner,
      member,
    ]);
    assert.equal((await db.query("select * from triply.trips")).rows.length, 1);
    assert.deepEqual(
      (
        await db.query<{ share_cents: number }>(
          "select share_cents from triply.expense_participants order by position",
        )
      ).rows.map((row) => Number(row.share_cents)),
      [51, 50],
    );
    await assert.rejects(
      db.query("delete from triply.expenses"),
      /permission denied/,
    );
    await db.exec(`set request.jwt.claim.sub = '${stranger}'`);
    assert.deepEqual(
      (
        await db.query<{ result: { trips: unknown[] } }>(
          "select triply.get_workspace() as result",
        )
      ).rows[0].result.trips,
      [],
    );
    for (const table of [
      "trips",
      "trip_members",
      "expenses",
      "expense_participants",
      "payments",
    ])
      assert.equal(
        (await db.query(`select * from triply.${table}`)).rows.length,
        0,
      );
    await assert.rejects(save(trip, 1), /access denied/);
    await db.exec(`set request.jwt.claim.sub = '${member}'`);
    assert.equal((await db.query("select * from triply.trips")).rows.length, 1);
    await assert.rejects(
      save({ ...trip, name: "Hijacked" }, 1),
      /Only the trip owner/,
    );
    await assert.rejects(
      save({ ...trip, members: [{ id: member }] }, 1),
      /Only the trip owner/,
    );
    await save(
      {
        ...trip,
        expenses: [
          {
            ...trip.expenses[0],
            title: "Dinner",
            amount: 103,
            payer: member,
            category: "Other",
            date: "2026-10-04",
            participants: [member],
          },
        ],
      },
      1,
    );
    const edited = await db.query<{
      id: string;
      title: string;
      payer_id: string;
      category: string;
      spent_on: string;
    }>(
      "select id, title, payer_id, category, spent_on::text from triply.expenses",
    );
    assert.deepEqual(edited.rows, [
      {
        id: expenseId,
        title: "Dinner",
        payer_id: member,
        category: "Other",
        spent_on: "2026-10-04",
      },
    ]);
    const editedShares = await db.query<{
      user_id: string;
      share_cents: number;
    }>("select user_id, share_cents from triply.expense_participants");
    assert.equal(editedShares.rows.length, 1);
    assert.equal(editedShares.rows[0].user_id, member);
    assert.equal(Number(editedShares.rows[0].share_cents), 103);
    await assert.rejects(save(trip, 1), /changed on another device/);
    await assert.rejects(
      save(
        {
          ...trip,
          expenses: [{ ...trip.expenses[0], participants: [stranger] }],
        },
        2,
      ),
      /foreign key/,
    );
    assert.equal(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from triply.expenses",
        )
      ).rows[0].amount_cents,
      103,
    );
    assert.equal(
      (await db.query<{ version: number }>("select version from triply.trips"))
        .rows[0].version,
      2,
    );
    const paid = {
      ...trip,
      payments: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          from: member,
          to: owner,
          amount: 50,
        },
      ],
    };
    await save(paid, 2);
    assert.equal(
      (await db.query("select * from triply.payments")).rows.length,
      1,
    );
    await save(trip, 3);
    assert.equal(
      (await db.query("select * from triply.payments")).rows.length,
      0,
    );
    await save({ ...trip, expenses: [] }, 4);
    assert.equal(
      (await db.query("select * from triply.expense_participants")).rows.length,
      0,
    );
    await db.exec(`set request.jwt.claim.sub = '${owner}'`);
    await save({ ...trip, members: [...trip.members, { id: stranger }] }, 5);
    await db.exec(`set request.jwt.claim.sub = '${stranger}'`);
    assert.equal((await db.query("select * from triply.trips")).rows.length, 1);
    await db.exec(`set request.jwt.claim.sub = '${owner}'`);
    await save(trip, 6);
    await db.exec(`set request.jwt.claim.sub = '${stranger}'`);
    assert.equal((await db.query("select * from triply.trips")).rows.length, 0);
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query("select * from triply.trips"),
      /permission denied/,
    );
    await assert.rejects(save(trip, 5), /permission denied/);
    await db.exec("reset role");
    assert.deepEqual((await db.query("select * from public.expenses")).rows, [
      { id: 99 },
    ]);
  } finally {
    await db.close();
  }
});
