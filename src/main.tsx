import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Auth from "./Auth.tsx";
import PwaStatus from "./PwaStatus.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Auth />
    <PwaStatus />
  </StrictMode>,
);
