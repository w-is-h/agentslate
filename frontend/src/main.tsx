import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "@/App";
import { DashProvider } from "@/api/state";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <DashProvider>
        <App />
      </DashProvider>
    </HashRouter>
  </StrictMode>,
);
