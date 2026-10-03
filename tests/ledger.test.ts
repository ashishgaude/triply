import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balances,
  membersFromUsers,
  replaceTrip,
  withoutSampleTrips,
  settlements,
  splitCents,
} from "../src/ledger.ts";
import type { Trip } from "../src/ledger.ts";

function testTrip(): Trip {
  const members = [
    { id: "alex", name: "Alex" },
    { id: "jamie", name: "Jamie" },
    { id: "sam", name: "Sam" },
    { id: "riley", name: "Riley" },
  ];
  return {
    id: "test-trip",
    name: "Test trip",
    destination: "",
    currency: "EUR",
    sample: false,
    members,
    expenses: [
      {
        id: "test-expense",
        title: "Test expense",
        amount: 101,
        payer: "alex",
        participants: members.map((member) => member.id),
        category: "Other",
        date: "2026-10-03",
      },
    ],
    payments: [],
  };
}

test("equal splits preserve every cent, including amounts smaller than the group", () => {
  assert.deepEqual(splitCents(100, 3), [34, 33, 33]);
  assert.deepEqual(splitCents(2, 4), [1, 1, 0, 0]);
  assert.throws(() => splitCents(0, 4));
  assert.throws(() => splitCents(100, 0));
});

test("balances sum to zero and proposed repayments settle everyone", () => {
  const trip = testTrip();
  assert.equal(
    Object.values(balances(trip)).reduce((sum, amount) => sum + amount, 0),
    0,
  );
  trip.payments = settlements(trip).map((transfer, index) => ({
    ...transfer,
    id: String(index),
  }));
  assert.ok(Object.values(balances(trip)).every((amount) => amount === 0));
  assert.deepEqual(settlements(trip), []);
});

test("only selected travelers owe their share, even when the payer is excluded", () => {
  const trip = testTrip();
  trip.expenses = [
    {
      ...trip.expenses[0],
      amount: 101,
      payer: "alex",
      participants: ["jamie", "sam"],
    },
  ];
  assert.deepEqual(balances(trip), {
    alex: 101,
    jamie: -51,
    sam: -50,
    riley: 0,
  });
});

test("updating the selected trip preserves every other trip and its expenses", () => {
  const first = testTrip();
  const second = {
    ...testTrip(),
    id: "second-trip",
    name: "Mountain weekend",
    expenses: [],
  };
  const workspace = { trips: [first, second], selectedTripId: second.id };
  const updated = replaceTrip(workspace, {
    ...second,
    expenses: [first.expenses[0]],
  });
  assert.equal(updated.trips[0], first);
  assert.equal(updated.trips[0].expenses.length, 1);
  assert.equal(updated.trips[1].expenses.length, 1);
  assert.equal(updated.selectedTripId, second.id);
  assert.equal(workspace.trips[1].expenses.length, 0);
  assert.throws(() => replaceTrip(workspace, { ...second, id: "missing" }));
});

test("travelers retain database user IDs even when display names match", () => {
  const users = [
    { id: "user-one", display_name: "Sam" },
    { id: "user-two", display_name: "Sam" },
  ];
  assert.deepEqual(membersFromUsers(users, ["user-two", "user-one"]), [
    { id: "user-two", name: "Sam" },
    { id: "user-one", name: "Sam" },
  ]);
  assert.throws(() => membersFromUsers(users, []));
  assert.throws(() => membersFromUsers(users, ["user-one", "user-one"]));
  assert.throws(() => membersFromUsers(users, ["missing"]));
});

test("removing demo trips preserves real data and allows an empty workspace", () => {
  const real = testTrip();
  const sample = { ...testTrip(), id: "sample-trip", sample: true };
  assert.deepEqual(
    withoutSampleTrips({ trips: [sample, real], selectedTripId: sample.id }),
    { trips: [real], selectedTripId: real.id },
  );
  assert.deepEqual(
    withoutSampleTrips({ trips: [sample], selectedTripId: sample.id }),
    { trips: [], selectedTripId: "" },
  );
  assert.deepEqual(withoutSampleTrips({ trips: [], selectedTripId: "" }), {
    trips: [],
    selectedTripId: "",
  });
});
