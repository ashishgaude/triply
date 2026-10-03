import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, Search } from "lucide-react";
import { supabase } from "./supabase";
import { membersFromUsers } from "./ledger";
import type { Member, RegisteredUser } from "./ledger";
import "./UserPicker.css";

async function fetchUsers(signal: AbortSignal): Promise<RegisteredUser[]> {
  if (!supabase) throw new Error("Authentication is not configured.");
  const users: RegisteredUser[] = [];
  const pageSize = 200;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("users")
      .select("id,display_name")
      .order("display_name")
      .order("id")
      .range(start, start + pageSize - 1)
      .abortSignal(signal);
    if (error) {
      if (error.code === "PGRST106")
        throw new Error(
          "Expose the triply schema in Supabase's Data API settings to load users.",
        );
      if (error.code === "PGRST205" || error.code === "42P01")
        throw new Error(
          "The user directory isn't set up yet. Apply the traveler-directory migration for triply.users.",
        );
      throw new Error("Couldn't load registered users. Please try again.");
    }
    const rows = data ?? [];
    if (
      rows.some(
        (row) =>
          typeof row.id !== "string" ||
          typeof row.display_name !== "string" ||
          !row.display_name.trim(),
      )
    )
      throw new Error("The user directory contains an invalid record.");
    users.push(...(rows as RegisteredUser[]));
    if (rows.length < pageSize) return users;
  }
}

export default function UserPicker({
  value,
  onChange,
  excludedIds = [],
  label = "Travelers",
}: {
  value: Member[];
  onChange: (members: Member[]) => void;
  excludedIds?: string[];
  label?: string;
}) {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetchUsers(controller.signal)
      .then((data) => {
        if (!active) return;
        setUsers(data);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof Error ? cause.message : "Couldn't load users.",
        );
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision]);

  function refresh() {
    onChange([]);
    setLoading(true);
    setError("");
    setRevision((current) => current + 1);
  }

  const available = users.filter((user) => !excludedIds.includes(user.id));
  const visible = available.filter((user) =>
    `${user.display_name} ${user.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <fieldset className="user-picker">
      <legend>{label}</legend>
      <div className="user-picker-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search registered users"
            placeholder="Search users..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading || Boolean(error)}
          />
        </label>
        <button
          type="button"
          className="icon-button"
          title="Refresh user list"
          disabled={loading}
          onClick={refresh}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {loading ? (
        <p className="user-picker-status" role="status">
          <LoaderCircle size={16} className="auth-spinner" />
          Loading users...
        </p>
      ) : error ? (
        <div className="user-picker-status">
          <p className="form-error" role="alert">
            {error}
          </p>
          <button type="button" className="button secondary" onClick={refresh}>
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      ) : (
        <div className="user-picker-list">
          {visible.map((user) => (
            <label className="directory-user" key={user.id}>
              <input
                type="checkbox"
                aria-label={`Select ${user.display_name} (${user.id.slice(0, 8)})`}
                checked={value.some((member) => member.id === user.id)}
                onChange={(event) => {
                  const ids = event.target.checked
                    ? [...value.map((member) => member.id), user.id]
                    : value
                        .filter((member) => member.id !== user.id)
                        .map((member) => member.id);
                  onChange(ids.length ? membersFromUsers(users, ids) : []);
                }}
              />
              <span>
                <strong>{user.display_name}</strong>
                <small>{user.id.slice(0, 8)}</small>
              </span>
            </label>
          ))}
          {!visible.length && (
            <p className="user-picker-status">
              {!users.length
                ? "No registered users found."
                : !available.length
                  ? "All registered users are already on this trip."
                  : "No users match your search."}
            </p>
          )}
        </div>
      )}
      {!loading && !error && (
        <p className="field-hint">{value.length} selected</p>
      )}
    </fieldset>
  );
}
