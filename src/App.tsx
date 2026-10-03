import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  Coffee,
  Download,
  FolderPlus,
  Globe2,
  HandCoins,
  Hotel,
  MapPin,
  LogOut,
  LoaderCircle,
  RefreshCw,
  Plane,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Sparkles,
  Ticket,
  Trash2,
  Users,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import {
  balances,
  replaceTrip,
  withoutSampleTrips,
  settlements,
  splitCents,
  normalizeTripIcon,
} from "./ledger";
import type { Expense, Member, Transfer, Trip, Workspace } from "./ledger";
import { accountStorageKey } from "./auth-utils";
import UserPicker from "./UserPicker";
import TripIcon, { TripIconPicker } from "./TripIcon";
import { fetchWorkspace, persistTrip } from "./trip-store";
import "./App.css";

const STORAGE_KEY = "triply-workspace-v2";
const LEGACY_STORAGE_KEY = "triply-trip-v1";
const categories = [
  "Food & drinks",
  "Stay",
  "Transport",
  "Activities",
  "Other",
];
const categoryIcons = {
  "Food & drinks": Utensils,
  Stay: Hotel,
  Transport: Plane,
  Activities: Ticket,
  Other: ReceiptText,
};
const currencies = ["EUR", "USD", "GBP", "INR", "CAD", "AUD"];
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amount / 100,
  );
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(
    new Date(`${date}T12:00:00`),
  );

function validateTrip(trip: Trip): Trip {
  if (
    typeof trip.name !== "string" ||
    typeof trip.destination !== "string" ||
    !currencies.includes(trip.currency) ||
    !Array.isArray(trip.members) ||
    !trip.members.length ||
    !Array.isArray(trip.expenses) ||
    !Array.isArray(trip.payments)
  )
    throw new Error("Invalid trip");
  const ids = trip.members.map((member) => member.id);
  if (
    trip.members.some(
      (member) =>
        typeof member.id !== "string" || typeof member.name !== "string",
    ) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Invalid members");
  if (
    trip.expenses.some(
      (expense) =>
        typeof expense.title !== "string" ||
        !Number.isSafeInteger(expense.amount) ||
        expense.amount <= 0 ||
        !ids.includes(expense.payer) ||
        !Array.isArray(expense.participants) ||
        !expense.participants.length ||
        new Set(expense.participants).size !== expense.participants.length ||
        expense.participants.some((id) => !ids.includes(id)) ||
        !categories.includes(expense.category) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(expense.date) ||
        Number.isNaN(Date.parse(expense.date)),
    )
  )
    throw new Error("Invalid expenses");
  if (
    trip.payments.some(
      (payment) =>
        !ids.includes(payment.from) ||
        !ids.includes(payment.to) ||
        !Number.isSafeInteger(payment.amount) ||
        payment.amount <= 0,
    )
  )
    throw new Error("Invalid payments");
  return {
    ...trip,
    id: typeof trip.id === "string" && trip.id ? trip.id : "legacy-trip",
  };
}

function loadWorkspace(
  storageKey = STORAGE_KEY,
  allowLegacy = true,
): Workspace {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const workspace = JSON.parse(stored) as Workspace;
      if (!Array.isArray(workspace.trips)) throw new Error("Invalid workspace");
      const trips = workspace.trips.map(validateTrip);
      if (new Set(trips.map((trip) => trip.id)).size !== trips.length)
        throw new Error("Duplicate trips");
      return withoutSampleTrips({
        trips,
        selectedTripId: workspace.selectedTripId,
      });
    }
    const legacy = allowLegacy
      ? localStorage.getItem(LEGACY_STORAGE_KEY)
      : null;
    if (!legacy) return { trips: [], selectedTripId: "" };
    const trip = validateTrip(JSON.parse(legacy) as Trip);
    return withoutSampleTrips({ trips: [trip], selectedTripId: trip.id });
  } catch {
    return { trips: [], selectedTripId: "" };
  }
}

function Avatar({
  member,
  index = 0,
  small = false,
}: {
  member: Member;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${index % 4} ${small ? "avatar-small" : ""}`}
      title={member.name}
    >
      {member.name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" title="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

type Draft = {
  id?: string;
  title: string;
  amount: string;
  payer: string;
  participants: string[];
  category: string;
  date: string;
};

function App({
  userId,
  userEmail,
  onSignOut,
  signingOut,
  authError,
}: {
  userId: string;
  userEmail: string;
  onSignOut: () => Promise<void>;
  signingOut: boolean;
  authError: string;
}) {
  const storageKey = accountStorageKey(userId);
  const [workspace, setWorkspace] = useState<Workspace>({
    trips: [],
    selectedTripId: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revision, setRevision] = useState(0);
  const saveInFlight = useRef(false);
  const newTripId = useRef("");
  const selectedTripRef = useRef("");
  useEffect(() => {
    let active = true;
    let selected = selectedTripRef.current;
    try {
      selected ||= localStorage.getItem(`triply-selected-trip:${userId}`) || "";
    } catch {}
    fetchWorkspace(selected)
      .then((data) => {
        if (!active) return;
        setWorkspace(data);
        selectedTripRef.current = data.selectedTripId;
        setDatabaseError("");
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setDatabaseError(
          cause instanceof Error ? cause.message : "Couldn't load trips.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, revision]);
  const [hasLocalTrips, setHasLocalTrips] = useState(() => {
    try {
      return (
        loadWorkspace(storageKey, false).trips.length > 0 ||
        loadWorkspace().trips.length > 0
      );
    } catch {
      return false;
    }
  });
  const trip = workspace.trips.find(
    (item) => item.id === workspace.selectedTripId,
  );
  const [tab, setTab] = useState("Expenses");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All categories");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tripModal, setTripModal] = useState<"new" | "edit" | null>(null);
  const [peopleModal, setPeopleModal] = useState(false);
  const [selectedTravelers, setSelectedTravelers] = useState<Member[]>([]);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [deletion, setDeletion] = useState<{
    id: string;
    kind: "expense" | "payment";
    title: string;
  } | null>(null);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const total = (trip?.expenses ?? []).reduce(
    (sum, expense) => sum + expense.amount,
    0,
  );
  const balance = trip ? balances(trip) : {};
  const transfers = trip ? settlements(trip) : [];
  const member = (id: string) => {
    const person = trip?.members.find((item) => item.id === id);
    if (!person) throw new Error("Traveler not found.");
    return person;
  };
  const format = (amount: number) => money(amount, trip?.currency ?? "EUR");
  const visibleExpenses = (trip?.expenses ?? [])
    .filter(
      (expense) =>
        (filter === "All categories" || expense.category === filter) &&
        `${expense.title} ${member(expense.payer).name}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((first, second) => second.date.localeCompare(first.date));
  const canManageTrip = trip?.ownerId === userId;
  async function updateTrip(next: Trip): Promise<boolean> {
    if (saveInFlight.current) return false;
    saveInFlight.current = true;
    setSaving(true);
    setFormError("");
    setActionError("");
    try {
      const saved = await persistTrip(next);
      const isNew = !workspace.trips.some((item) => item.id === saved.id);
      setWorkspace((current) =>
        isNew
          ? { trips: [saved, ...current.trips], selectedTripId: saved.id }
          : replaceTrip(current, saved),
      );
      if (isNew) {
        selectedTripRef.current = saved.id;
        try {
          localStorage.setItem(`triply-selected-trip:${userId}`, saved.id);
        } catch {}
      }
      return true;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Couldn't save your changes. Please try again.";
      setFormError(message);
      setActionError(message);
      return false;
    } finally {
      setSaving(false);
      saveInFlight.current = false;
    }
  }

  function refreshTrips() {
    if (saveInFlight.current) return;
    newTripId.current = "";
    setDraft(null);
    setTransfer(null);
    setDeletion(null);
    setTripModal(null);
    setPeopleModal(false);
    setSelectedTravelers([]);
    setFormError("");
    setActionError("");
    setLoading(true);
    setRevision((current) => current + 1);
  }

  function selectTrip(id: string) {
    if (saving || !workspace.trips.some((item) => item.id === id)) return;
    setWorkspace((current) => ({ ...current, selectedTripId: id }));
    selectedTripRef.current = id;
    try {
      localStorage.setItem(`triply-selected-trip:${userId}`, id);
    } catch {}
    setTab("Expenses");
    setQuery("");
    setFilter("All categories");
    setDraft(null);
    setTransfer(null);
    setDeletion(null);
    setPeopleModal(false);
    setTripModal(null);
    setFormError("");
    setSelectedTravelers([]);
  }

  function exportLocalBackup() {
    const account = loadWorkspace(storageKey, false);
    const unsigned = loadWorkspace();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ account, unsigned }, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "triply-local-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setHasLocalTrips(false);
  }

  function openDeletion(value: NonNullable<typeof deletion>) {
    setFormError("");
    setDeletion(value);
  }

  function openExpense(expense?: Expense) {
    if (!trip || saving) return;
    setFormError("");
    setDraft(
      expense
        ? { ...expense, amount: (expense.amount / 100).toFixed(2) }
        : {
            title: "",
            amount: "",
            payer: trip.members[0]?.id || "",
            participants: trip.members.map((person) => person.id),
            category: "Food & drinks",
            date: today(),
          },
    );
  }
  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !trip) return;
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(draft.amount)) {
      setFormError("Enter an amount with no more than two decimal places.");
      return;
    }
    const amount = Math.round(Number(draft.amount) * 100);
    if (
      amount <= 0 ||
      !draft.participants.length ||
      !draft.payer ||
      !draft.title.trim()
    ) {
      setFormError(
        "Add a description, positive amount, payer, and at least one traveler.",
      );
      return;
    }
    const expense: Expense = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      title: draft.title.trim(),
      amount,
    };
    if (
      !(await updateTrip({
        ...trip,
        expenses: draft.id
          ? trip.expenses.map((item) => (item.id === draft.id ? expense : item))
          : [...trip.expenses, expense],
      }))
    )
      return;
    setDraft(null);
    setNotice(draft.id ? "Expense updated" : "Expense added");
  }
  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const destination = String(data.get("destination")).trim();
    const icon = normalizeTripIcon(data.get("icon"));
    if (!name) {
      setFormError("Give your trip a name.");
      return;
    }
    if (tripModal === "new") {
      if (!selectedTravelers.length) {
        setFormError("Select at least one registered user for this trip.");
        return;
      }
      const newTrip: Trip = {
        id: (newTripId.current ||= crypto.randomUUID()),
        name,
        icon,
        destination,
        currency: String(data.get("currency")),
        sample: false,
        ownerId: userId,
        members: selectedTravelers,
        expenses: [],
        payments: [],
      };
      if (!(await updateTrip(newTrip))) return;
      newTripId.current = "";
      setTab("Expenses");
      setQuery("");
      setFilter("All categories");
    } else if (
      trip &&
      !(await updateTrip({ ...trip, name, icon, destination }))
    )
      return;
    setTripModal(null);
    setSelectedTravelers([]);
    setNotice(tripModal === "new" ? "Your trip is ready" : "Trip updated");
  }
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trip) return;
    if (
      !selectedTravelers.length ||
      selectedTravelers.some((person) =>
        trip.members.some((existing) => existing.id === person.id),
      )
    ) {
      setFormError("Select registered users who aren't already on this trip.");
      return;
    }
    if (
      !(await updateTrip({
        ...trip,
        members: [...trip.members, ...selectedTravelers],
      }))
    )
      return;
    setSelectedTravelers([]);
    setFormError("");
    setNotice(
      `${selectedTravelers.length} ${selectedTravelers.length === 1 ? "traveler" : "travelers"} added`,
    );
  }
  function exportExpenses() {
    if (!trip) return;
    const rows = [
      [
        "Date",
        "Description",
        "Category",
        "Amount",
        "Currency",
        "Paid by",
        "Split between",
      ],
      ...trip.expenses.map((expense) => [
        expense.date,
        expense.title,
        expense.category,
        (expense.amount / 100).toFixed(2),
        trip.currency,
        member(expense.payer).name,
        expense.participants.map((id) => member(id).name).join(", "),
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "triply-expenses.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const previewAmount =
    draft && /^\d{1,8}(\.\d{1,2})?$/.test(draft.amount)
      ? Math.round(Number(draft.amount) * 100)
      : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Triply home">
          <span className="brand-icon">
            <Plane size={21} />
          </span>
          triply<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <div className="nav-item active">
          <Wallet size={19} /> My trips{" "}
          <span className="nav-count">{workspace.trips.length}</span>
        </div>
        <nav className="trip-list" aria-label="Your trips">
          {workspace.trips.map((item) => (
            <button
              key={item.id}
              className={`sidebar-trip ${item.id === workspace.selectedTripId ? "current-trip" : ""}`}
              aria-current={
                item.id === workspace.selectedTripId ? "page" : undefined
              }
              onClick={() => selectTrip(item.id)}
            >
              <TripIcon icon={item.icon} size={16} />
              <span>{item.name}</span>
            </button>
          ))}
        </nav>
        <button
          className="nav-item"
          disabled={loading || saving || Boolean(databaseError)}
          onClick={() => {
            setFormError("");
            setSelectedTravelers([]);
            setTripModal("new");
          }}
        >
          <FolderPlus size={19} /> New trip
        </button>
        <div className="sidebar-bottom">
          <span className="local-icon">
            <Globe2 size={19} />
          </span>
          <div>
            <strong>A little less accounting.</strong>
            <span>A little more adventure.</span>
          </div>
          <div className="local-status">
            <span /> Your personal workspace
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-label">My trips</span>
            <span>/</span>
            <div className="trip-selector">
              {trip && <TripIcon icon={trip.icon} size={17} />}
              <select
                aria-label="Select trip"
                value={workspace.selectedTripId}
                disabled={!workspace.trips.length || loading || saving}
                onChange={(event) => selectTrip(event.target.value)}
              >
                {!workspace.trips.length && <option value="">No trips</option>}
                {workspace.trips.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
          </div>
          <span className="saved-status">
            <span
              className={databaseError || actionError ? "status-error" : ""}
            />
            {saving
              ? "Saving..."
              : loading
                ? "Loading..."
                : databaseError || actionError
                  ? "Could not sync"
                  : "Saved to database"}
          </span>
          <button
            className="icon-button"
            title="Refresh trips"
            disabled={loading || saving}
            onClick={refreshTrips}
          >
            <RefreshCw size={17} />
          </button>
          <div className="account-controls">
            <span className="account-email" title={userEmail}>
              {userEmail}
            </span>
            <button
              className="icon-button"
              title={signingOut ? "Signing out..." : "Sign out"}
              disabled={signingOut}
              onClick={onSignOut}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main>
          {authError && (
            <p className="warning auth-account-error" role="alert">
              {authError}
            </p>
          )}
          {hasLocalTrips && (
            <div className="local-import">
              <span>
                Browser-only trips were found. Keep a backup before recreating
                them in the database.
              </span>
              <button className="button secondary" onClick={exportLocalBackup}>
                Download local backup <Download size={14} />
              </button>
            </div>
          )}
          {actionError && (
            <div className="warning" role="alert">
              {actionError}{" "}
              <button
                className="button secondary"
                onClick={refreshTrips}
                disabled={saving}
              >
                Refresh trips
              </button>
            </div>
          )}
          {loading ? (
            <section className="no-trips" role="status">
              <LoaderCircle size={26} className="auth-spinner" />
              <p>Loading your trips...</p>
            </section>
          ) : databaseError ? (
            <section className="no-trips">
              <h1>Couldn't load trips</h1>
              <p role="alert">{databaseError}</p>
              <button className="button primary" onClick={refreshTrips}>
                <RefreshCw size={17} /> Retry
              </button>
            </section>
          ) : trip ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    GOOD COMPANY. SHARED ADVENTURES.
                  </div>
                  <div className="trip-heading">
                    <TripIcon icon={trip.icon} size={26} />
                    <h1>{trip.name}</h1>
                  </div>
                  <div className="trip-meta">
                    <span>
                      <MapPin size={15} />
                      {trip.destination || "Destination not set"}
                    </span>
                    <span className="meta-dot" />
                    <span>{trip.members.length} travelers</span>
                  </div>
                </div>
                <button
                  className="icon-button trip-settings"
                  disabled={!canManageTrip || saving}
                  title="Edit trip"
                  onClick={() => {
                    setFormError("");
                    setTripModal("edit");
                  }}
                >
                  <Settings2 size={20} />
                </button>
              </div>
              <section className="trip-banner" aria-label="Trip overview">
                <img
                  src="https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1600&q=85"
                  alt="Riverside city rooftops"
                />
                <div className="banner-content">
                  <span className="banner-tag">
                    <MapPin size={13} />{" "}
                    {trip.destination || "Your next adventure"}
                  </span>
                  <h2>
                    The memories are shared.
                    <br />
                    The expenses should be, too.
                  </h2>
                  <div className="banner-people">
                    <div className="avatar-stack">
                      {trip.members.slice(0, 5).map((person, index) => (
                        <Avatar
                          key={person.id}
                          member={person}
                          index={index}
                          small
                        />
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setFormError("");
                        setPeopleModal(true);
                      }}
                    >
                      {trip.members.length} on this adventure{" "}
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              </section>
              <section className="stats" aria-label="Trip totals">
                <div className="stat">
                  <span className="stat-label">
                    <Wallet size={16} /> Total trip spend
                  </span>
                  <strong>{format(total)}</strong>
                  <span>
                    {trip.expenses.length} shared{" "}
                    {trip.expenses.length === 1 ? "expense" : "expenses"}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <Users size={16} /> Average per traveler
                  </span>
                  <strong>
                    {format(Math.round(total / trip.members.length))}
                  </strong>
                  <span>Across {trip.members.length} travelers</span>
                </div>
                <div className="stat">
                  <span className="stat-label">
                    <HandCoins size={16} /> Left to settle
                  </span>
                  <strong className="teal-text">
                    {format(
                      transfers.reduce((sum, item) => sum + item.amount, 0),
                    )}
                  </strong>
                  <span>
                    {transfers.length
                      ? `${transfers.length} ${transfers.length === 1 ? "payment" : "payments"} to square things up`
                      : "Everyone is all square"}
                  </span>
                </div>
              </section>
              <div className="content-grid">
                <section className="ledger-section">
                  <div className="section-toolbar">
                    <nav className="tabs" aria-label="Trip views">
                      {["Expenses", "Balances", "Travelers"].map((value) => (
                        <button
                          key={value}
                          aria-current={tab === value ? "page" : undefined}
                          className={tab === value ? "selected" : ""}
                          onClick={() => setTab(value)}
                        >
                          {value}
                          {value === "Expenses" && (
                            <span>{trip.expenses.length}</span>
                          )}
                        </button>
                      ))}
                    </nav>
                    <button
                      className="button primary"
                      disabled={saving}
                      onClick={() => openExpense()}
                    >
                      <Plus size={17} /> Add expense
                    </button>
                  </div>
                  {tab === "Expenses" && (
                    <>
                      <div className="filters">
                        <label className="search-field">
                          <Search size={17} />
                          <input
                            aria-label="Search expenses"
                            placeholder="Search expenses..."
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                          />
                          {query && (
                            <button
                              className="icon-button"
                              title="Clear search"
                              onClick={() => setQuery("")}
                            >
                              <X size={14} />
                            </button>
                          )}
                        </label>
                        <div className="filter-select">
                          <select
                            aria-label="Filter by category"
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                          >
                            <option>All categories</option>
                            {categories.map((category) => (
                              <option key={category}>{category}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} />
                        </div>
                        <button
                          className="icon-button export"
                          title="Export expenses as CSV"
                          onClick={exportExpenses}
                          disabled={!trip.expenses.length}
                        >
                          <Download size={18} />
                        </button>
                      </div>
                      <div className="expense-table">
                        <div className="table-head">
                          <span>EXPENSE</span>
                          <span>PAID BY</span>
                          <span>AMOUNT</span>
                          <span />
                        </div>
                        {visibleExpenses.map((expense) => {
                          const Icon =
                            categoryIcons[
                              expense.category as keyof typeof categoryIcons
                            ] || ReceiptText;
                          return (
                            <div className="expense-row" key={expense.id}>
                              <div className="expense-info">
                                <span
                                  className={`category-icon category-${categories.indexOf(expense.category)}`}
                                >
                                  <Icon size={20} />
                                </span>
                                <div>
                                  <button
                                    className="expense-title"
                                    onClick={() => openExpense(expense)}
                                  >
                                    {expense.title}
                                  </button>
                                  <div className="expense-subtitle">
                                    {dateLabel(expense.date)}{" "}
                                    <span>&middot;</span> {expense.category}{" "}
                                    <span>&middot;</span>{" "}
                                    {expense.participants.length ===
                                    trip.members.length
                                      ? "Everyone"
                                      : `${expense.participants.length} travelers`}
                                  </div>
                                </div>
                              </div>
                              <div className="payer">
                                <Avatar
                                  member={member(expense.payer)}
                                  index={trip.members.findIndex(
                                    (person) => person.id === expense.payer,
                                  )}
                                  small
                                />
                                <span>{member(expense.payer).name}</span>
                              </div>
                              <strong className="expense-amount">
                                {format(expense.amount)}
                              </strong>
                              <div className="expense-actions">
                                <button
                                  className="icon-button edit-expense"
                                  title={`Edit ${expense.title}`}
                                  disabled={saving}
                                  onClick={() => openExpense(expense)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  className="icon-button delete-expense"
                                  title={`Delete ${expense.title}`}
                                  disabled={saving}
                                  onClick={() =>
                                    openDeletion({
                                      id: expense.id,
                                      kind: "expense",
                                      title: expense.title,
                                    })
                                  }
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {!visibleExpenses.length && (
                          <div className="empty-state">
                            <ReceiptText size={30} />
                            <h3>
                              {trip.expenses.length
                                ? "No matching expenses"
                                : "A fresh start"}
                            </h3>
                            <p>
                              {trip.expenses.length
                                ? "Try another search or category."
                                : "Your first shared expense belongs here."}
                            </p>
                            {!trip.expenses.length && (
                              <button
                                className="button secondary"
                                onClick={() => openExpense()}
                              >
                                <Plus size={16} /> Add an expense
                              </button>
                            )}
                          </div>
                        )}
                        <div className="table-footer">
                          <span>
                            {visibleExpenses.length}{" "}
                            {visibleExpenses.length === 1
                              ? "expense"
                              : "expenses"}
                          </span>
                          <span>
                            Total{" "}
                            <strong>
                              {format(
                                visibleExpenses.reduce(
                                  (sum, expense) => sum + expense.amount,
                                  0,
                                ),
                              )}
                            </strong>
                          </span>
                        </div>
                      </div>
                      <div className="ledger-note">
                        <CheckCheck size={15} /> A fair split, down to the last
                        cent.
                      </div>
                    </>
                  )}
                  {tab === "Balances" && (
                    <div className="balances-view">
                      <div className="view-intro">
                        <h2>Everyone's balance</h2>
                        <p>
                          Paid minus their share, including recorded repayments.
                        </p>
                      </div>
                      {trip.members.map((person, index) => (
                        <div className="balance-row" key={person.id}>
                          <Avatar member={person} index={index} />
                          <div>
                            <strong>{person.name}</strong>
                            <span>
                              {balance[person.id] > 0
                                ? "Gets back"
                                : balance[person.id] < 0
                                  ? "Owes"
                                  : "All settled"}
                            </span>
                          </div>
                          <strong
                            className={
                              balance[person.id] < 0
                                ? "coral-text"
                                : "teal-text"
                            }
                          >
                            {format(Math.abs(balance[person.id]))}
                          </strong>
                        </div>
                      ))}
                      <h3 className="payment-heading">Recorded repayments</h3>
                      {trip.payments.length ? (
                        trip.payments.map((payment) => (
                          <div className="payment-row" key={payment.id}>
                            <Check size={16} />
                            <span>
                              {member(payment.from).name} paid{" "}
                              {member(payment.to).name}
                            </span>
                            <strong>{format(payment.amount)}</strong>
                            <button
                              className="icon-button"
                              title="Undo repayment"
                              onClick={() =>
                                openDeletion({
                                  id: payment.id,
                                  kind: "payment",
                                  title: "this repayment",
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="muted">No repayments recorded yet.</p>
                      )}
                    </div>
                  )}
                  {tab === "Travelers" && (
                    <div className="travelers-view">
                      <div className="view-intro">
                        <h2>The travel crew</h2>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setFormError("");
                            setPeopleModal(true);
                          }}
                        >
                          <Plus size={16} /> Add traveler
                        </button>
                      </div>
                      {trip.members.map((person, index) => (
                        <div className="balance-row" key={person.id}>
                          <Avatar member={person} index={index} />
                          <div>
                            <strong>{person.name}</strong>
                            <span>
                              {
                                trip.expenses.filter(
                                  (expense) => expense.payer === person.id,
                                ).length
                              }{" "}
                              expenses paid
                            </span>
                          </div>
                          <strong>
                            {format(
                              trip.expenses
                                .filter(
                                  (expense) => expense.payer === person.id,
                                )
                                .reduce(
                                  (sum, expense) => sum + expense.amount,
                                  0,
                                ),
                            )}
                          </strong>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <aside className="settlement-panel">
                  <div className="settlement-heading">
                    <h2>Settle up</h2>
                    <span className="icon-tint">
                      <HandCoins size={20} />
                    </span>
                  </div>
                  <p className="settlement-description">
                    A few payments. A clean slate.
                  </p>
                  {transfers.length ? (
                    <div className="transfer-list">
                      {transfers.map((item) => (
                        <div
                          className="transfer-item"
                          key={`${item.from}-${item.to}`}
                        >
                          <div className="transfer-route">
                            <Avatar
                              member={member(item.from)}
                              index={trip.members.findIndex(
                                (person) => person.id === item.from,
                              )}
                              small
                            />
                            <span>
                              <strong>{member(item.from).name}</strong>
                              <span>pays {member(item.to).name}</span>
                            </span>
                            <strong className="transfer-amount">
                              {format(item.amount)}
                            </strong>
                          </div>
                          <button
                            className="settle-button"
                            onClick={() => {
                              setFormError("");
                              setTransfer(item);
                            }}
                          >
                            Record payment <ArrowUpRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="all-settled">
                      <CheckCheck size={28} />
                      <h3>All square!</h3>
                      <p>No outstanding balances.</p>
                    </div>
                  )}
                  <div className="settlement-foot">
                    <Sparkles size={15} />
                    <span>Fewer transfers, same fair split.</span>
                  </div>
                  <div className="spending-breakdown">
                    <h3>Where it went</h3>
                    {total > 0 ? (
                      categories
                        .filter((category) =>
                          trip.expenses.some(
                            (expense) => expense.category === category,
                          ),
                        )
                        .map((category) => {
                          const amount = trip.expenses
                            .filter((expense) => expense.category === category)
                            .reduce((sum, expense) => sum + expense.amount, 0);
                          return (
                            <div className="breakdown-row" key={category}>
                              <div>
                                <span>
                                  <i
                                    className={`category-color category-${categories.indexOf(category)}`}
                                  />
                                  {category}
                                </span>
                                <strong>{format(amount)}</strong>
                              </div>
                              <div className="progress-track">
                                <span
                                  className={`category-bar category-${categories.indexOf(category)}`}
                                  style={{
                                    width: `${(amount / total) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })
                    ) : (
                      <p className="muted">
                        Your trip spending will appear here.
                      </p>
                    )}
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <section className="no-trips">
              <span className="no-trips-icon">
                <MapPin size={30} />
              </span>
              <h1>No trips yet</h1>
              <p>Your next adventure starts here.</p>
              <button
                className="button primary"
                onClick={() => {
                  setFormError("");
                  setSelectedTravelers([]);
                  setTripModal("new");
                }}
              >
                <Plus size={17} /> New trip
              </button>
            </section>
          )}
          <footer className="page-footer">
            <span>Made for the trip, not the paperwork.</span>
            <span>
              <Coffee size={14} /> Enjoy the journey.
            </span>
          </footer>
        </main>
      </div>
      {trip && draft && (
        <Modal
          title={draft.id ? "Edit expense" : "Add an expense"}
          onClose={() => setDraft(null)}
        >
          <form onSubmit={saveExpense} className="modal-form">
            <label>
              Description
              <input
                autoFocus
                required
                maxLength={100}
                placeholder="Dinner, train tickets, a place to stay..."
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <div className="form-grid">
              <label>
                Amount ({trip.currency})
                <input
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft({ ...draft, amount: event.target.value })
                  }
                />
              </label>
              <label>
                Date
                <input
                  required
                  type="date"
                  value={draft.date}
                  onChange={(event) =>
                    setDraft({ ...draft, date: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Paid by
                <select
                  value={draft.payer}
                  onChange={(event) =>
                    setDraft({ ...draft, payer: event.target.value })
                  }
                >
                  {trip.members.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value })
                  }
                >
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Split equally between</legend>
              <div className="participant-list">
                {trip.members.map((person, index) => (
                  <label className="participant" key={person.id}>
                    <input
                      type="checkbox"
                      checked={draft.participants.includes(person.id)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          participants: event.target.checked
                            ? [...draft.participants, person.id]
                            : draft.participants.filter(
                                (id) => id !== person.id,
                              ),
                        })
                      }
                    />
                    <Avatar member={person} index={index} small />
                    {person.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {previewAmount > 0 && draft.participants.length > 0 && (
              <div className="split-preview">
                <Users size={16} />
                {format(
                  splitCents(previewAmount, draft.participants.length)[0],
                )}{" "}
                each
                {previewAmount % draft.participants.length
                  ? " (rounded to the cent)"
                  : ""}
              </div>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={saving}
              >
                <Check size={16} />
                {draft.id ? "Save changes" : "Add expense"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {tripModal && (
        <Modal
          title={tripModal === "new" ? "Start a new trip" : "Trip details"}
          onClose={() => {
            setTripModal(null);
            setSelectedTravelers([]);
          }}
        >
          <form className="modal-form" onSubmit={saveTrip}>
            <TripIconPicker
              defaultValue={tripModal === "edit" ? trip?.icon : "plane"}
              disabled={saving}
            />
            <label>
              Trip name
              <input
                autoFocus
                name="name"
                required
                maxLength={80}
                defaultValue={tripModal === "edit" ? trip?.name : ""}
                placeholder="A weekend away"
              />
            </label>
            <label>
              Destination
              <input
                name="destination"
                maxLength={80}
                defaultValue={tripModal === "edit" ? trip?.destination : ""}
                placeholder="Where are you headed?"
              />
            </label>
            {tripModal === "new" && (
              <>
                <label>
                  Currency
                  <select
                    name="currency"
                    defaultValue={trip?.currency ?? "EUR"}
                  >
                    {currencies.map((currency) => (
                      <option key={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
                <UserPicker
                  value={selectedTravelers}
                  onChange={setSelectedTravelers}
                />
              </>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setTripModal(null);
                  setSelectedTravelers([]);
                }}
              >
                Cancel
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={
                  saving || (tripModal === "new" && !selectedTravelers.length)
                }
              >
                <Check size={16} />
                {tripModal === "new" ? "Create trip" : "Save changes"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {trip && peopleModal && (
        <Modal
          title="Your travel crew"
          onClose={() => {
            setPeopleModal(false);
            setSelectedTravelers([]);
          }}
        >
          <div className="modal-form">
            <div className="manage-members">
              {trip.members.map((person, index) => {
                const inUse =
                  trip.expenses.some(
                    (expense) =>
                      expense.payer === person.id ||
                      expense.participants.includes(person.id),
                  ) ||
                  trip.payments.some(
                    (payment) =>
                      payment.from === person.id || payment.to === person.id,
                  );
                return (
                  <div key={person.id}>
                    <Avatar member={person} index={index} small />
                    <strong>{person.name}</strong>
                    <button
                      className="icon-button"
                      disabled={
                        saving ||
                        !canManageTrip ||
                        inUse ||
                        trip.members.length <= 1
                      }
                      title={
                        inUse
                          ? "Traveler is part of an expense or repayment"
                          : trip.members.length <= 1
                            ? "Keep at least one traveler"
                            : `Remove ${person.name}`
                      }
                      onClick={() =>
                        updateTrip({
                          ...trip,
                          members: trip.members.filter(
                            (item) => item.id !== person.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <form onSubmit={addMember}>
              <UserPicker
                value={selectedTravelers}
                onChange={setSelectedTravelers}
                excludedIds={trip.members.map((person) => person.id)}
                label="Add registered travelers"
              />
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="submit"
                  className="button primary"
                  disabled={
                    saving || !canManageTrip || !selectedTravelers.length
                  }
                >
                  <Plus size={16} /> Add travelers
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
      {trip && transfer && (
        <Modal title="Record a repayment" onClose={() => setTransfer(null)}>
          <div className="modal-form">
            <div className="repayment-preview">
              <HandCoins size={24} />
              <h3>
                {member(transfer.from).name} pays {member(transfer.to).name}
              </h3>
              <strong>{format(transfer.amount)}</strong>
            </div>
            <p className="muted">
              Only record this after the money has been sent. Triply does not
              transfer money.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setTransfer(null)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={saving}
                onClick={async () => {
                  if (
                    !(await updateTrip({
                      ...trip,
                      payments: [
                        ...trip.payments,
                        { ...transfer, id: crypto.randomUUID() },
                      ],
                    }))
                  )
                    return;
                  setTransfer(null);
                  setNotice("Repayment recorded");
                }}
              >
                <Check size={16} /> Mark as paid
              </button>
            </div>
          </div>
        </Modal>
      )}
      {trip && deletion && (
        <Modal
          title={
            deletion.kind === "expense" ? "Delete expense?" : "Undo repayment?"
          }
          onClose={() => setDeletion(null)}
        >
          <div className="modal-form">
            <p>
              Remove {deletion.title}? Everyone's balance will be recalculated.
            </p>
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setDeletion(null)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                disabled={saving}
                onClick={async () => {
                  if (
                    !(await updateTrip(
                      deletion.kind === "expense"
                        ? {
                            ...trip,
                            expenses: trip.expenses.filter(
                              (expense) => expense.id !== deletion.id,
                            ),
                          }
                        : {
                            ...trip,
                            payments: trip.payments.filter(
                              (payment) => payment.id !== deletion.id,
                            ),
                          },
                    ))
                  )
                    return;
                  setDeletion(null);
                  setNotice("Removed");
                }}
              >
                <Trash2 size={16} />
                {deletion.kind === "expense"
                  ? "Delete expense"
                  : "Undo repayment"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </div>
  );
}

export default App;
