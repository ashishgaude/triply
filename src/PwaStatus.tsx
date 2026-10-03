import { useState, useSyncExternalStore } from "react";
import { LoaderCircle, RefreshCw, WifiOff, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import "./PwaStatus.css";

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export default function PwaStatus() {
  const online = useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true,
  );
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError() {
      setError("Offline installation is unavailable in this browser.");
    },
  });

  async function applyUpdate() {
    if (!online || applying) return;
    setApplying(true);
    setError("");
    try {
      await updateServiceWorker(true);
    } catch {
      setError("Couldn't update Triply. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  if (online && !needRefresh && !error) return null;

  return (
    <aside className="pwa-status" role="status" aria-live="polite">
      <span className={`pwa-status-icon ${!online ? "pwa-offline" : ""}`}>
        {!online ? <WifiOff size={19} /> : <RefreshCw size={19} />}
      </span>
      <div className="pwa-status-message">
        <strong>
          {!online
            ? "You're offline"
            : error
              ? "App update"
              : "Triply update available"}
        </strong>
        <p>
          {!online
            ? "Reconnect to load or save trip data."
            : error || "Unsaved edits will be lost on reload."}
        </p>
      </div>
      {needRefresh && (
        <button
          className="button primary"
          disabled={!online || applying}
          onClick={applyUpdate}
        >
          {applying ? (
            <LoaderCircle size={15} className="auth-spinner" />
          ) : (
            <RefreshCw size={15} />
          )}
          Reload
        </button>
      )}
      {(needRefresh || error) && (
        <button
          className="icon-button"
          title="Dismiss update notice"
          disabled={applying}
          onClick={() => {
            setNeedRefresh(false);
            setError("");
          }}
        >
          <X size={17} />
        </button>
      )}
    </aside>
  );
}
