import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";
(window as unknown as { __errors: string[] }).__errors = [];
window.addEventListener("error", (e) => {
  (window as unknown as { __errors: string[] }).__errors.push(
    e.message + " @ " + e.filename + ":" + e.lineno,
  );
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
