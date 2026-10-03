import { supabase } from "./supabase";
import type { Trip, Workspace } from "./ledger";

function databaseError(error: { code?: string; message: string }): Error {
  if (error.code === "PGRST106")
    return new Error("Expose the triply schema in Supabase Data API settings.");
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code || ""))
    return new Error(
      "Trip storage isn't set up yet. Run the traveler-directory and trip-storage migrations in Supabase.",
    );
  return new Error(error.message);
}

export async function fetchWorkspace(selectedTripId = ""): Promise<Workspace> {
  if (!supabase) throw new Error("Authentication is not configured.");
  const { data, error } = await supabase.rpc("get_workspace");
  if (error) throw databaseError(error);
  if (!data || !Array.isArray(data.trips))
    throw new Error("The database returned an invalid workspace.");
  const trips = data.trips as Trip[];
  return {
    trips,
    selectedTripId: trips.some((trip) => trip.id === selectedTripId)
      ? selectedTripId
      : (trips[0]?.id ?? ""),
  };
}

export async function persistTrip(trip: Trip): Promise<Trip> {
  if (!supabase) throw new Error("Authentication is not configured.");
  const { data, error } = await supabase.rpc("save_trip", {
    p_trip: trip,
    p_expected_version: trip.version ?? null,
  });
  if (error) throw databaseError(error);
  if (!data || data.id !== trip.id || !Number.isInteger(data.version))
    throw new Error("The database returned an invalid save result.");
  return { ...trip, sample: false, version: data.version };
}
