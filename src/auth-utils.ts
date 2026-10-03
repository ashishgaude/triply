export function accountStorageKey(userId: string): string {
  if (!userId.trim()) throw new Error("A signed-in user is required");
  return `triply-workspace-v2:${userId}`;
}

export function isPasswordRecovery(url: string): boolean {
  const parsed = new URL(url);
  const hash = new URLSearchParams(parsed.hash.slice(1));
  return (
    parsed.searchParams.get("mode") === "reset-password" ||
    parsed.searchParams.get("type") === "recovery" ||
    hash.get("type") === "recovery"
  );
}

export function authRedirectUrl(
  origin: string,
  base: string,
  recovery = false,
): string {
  const url = new URL(base, origin);
  if (recovery) url.searchParams.set("mode", "reset-password");
  return url.toString();
}
