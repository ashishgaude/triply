export type Member = { id: string; name: string };
export type RegisteredUser = { id: string; display_name: string };

export function membersFromUsers(
  users: RegisteredUser[],
  selectedIds: string[],
): Member[] {
  if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length)
    throw new Error("Select at least one registered user, without duplicates.");
  return selectedIds.map((id) => {
    const user = users.find((item) => item.id === id);
    if (!user || !user.display_name.trim())
      throw new Error("Selected user is unavailable. Refresh the user list.");
    return { id: user.id, name: user.display_name.trim() };
  });
}

export type Expense = {
  id: string;
  title: string;
  amount: number;
  payer: string;
  participants: string[];
  category: string;
  date: string;
};
export type Payment = { id: string; from: string; to: string; amount: number };
export type Trip = {
  id: string;
  ownerId?: string;
  version?: number;
  name: string;
  destination: string;
  currency: string;
  sample: boolean;
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
};
export type Transfer = { from: string; to: string; amount: number };
export type Workspace = { trips: Trip[]; selectedTripId: string };

export function withoutSampleTrips(workspace: Workspace): Workspace {
  const trips = workspace.trips.filter((trip) => !trip.sample);
  return {
    trips,
    selectedTripId: trips.some((trip) => trip.id === workspace.selectedTripId)
      ? workspace.selectedTripId
      : (trips[0]?.id ?? ""),
  };
}

export function replaceTrip(workspace: Workspace, trip: Trip): Workspace {
  if (!workspace.trips.some((item) => item.id === trip.id))
    throw new Error("Trip not found");
  return {
    ...workspace,
    trips: workspace.trips.map((item) => (item.id === trip.id ? trip : item)),
  };
}

export function splitCents(amount: number, count: number): number[] {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isInteger(count) ||
    count <= 0
  ) {
    throw new Error(
      "An expense needs a positive amount and at least one traveler.",
    );
  }
  const share = Math.floor(amount / count);
  return Array.from(
    { length: count },
    (_, index) => share + (index < amount % count ? 1 : 0),
  );
}

export function balances(trip: Trip): Record<string, number> {
  const result = Object.fromEntries(
    trip.members.map((member) => [member.id, 0]),
  );
  for (const expense of trip.expenses) {
    result[expense.payer] += expense.amount;
    const shares = splitCents(expense.amount, expense.participants.length);
    expense.participants.forEach((id, index) => {
      result[id] -= shares[index];
    });
  }
  for (const payment of trip.payments) {
    result[payment.from] += payment.amount;
    result[payment.to] -= payment.amount;
  }
  return result;
}

export function settlements(trip: Trip): Transfer[] {
  const entries = Object.entries(balances(trip));
  const debtors = entries
    .filter(([, amount]) => amount < 0)
    .map(([id, amount]) => ({ id, amount: -amount }));
  const creditors = entries
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }));
  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  for (const debtor of debtors) {
    while (debtor.amount > 0 && creditorIndex < creditors.length) {
      const creditor = creditors[creditorIndex];
      const amount = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.id, to: creditor.id, amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
      if (creditor.amount === 0) creditorIndex++;
    }
  }
  return transfers;
}
