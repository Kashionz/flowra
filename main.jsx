import React from "react";
import { createRoot } from "react-dom/client";

import PersonalFinanceCashflowSimulator from "./personal_finance_cashflow_simulator.jsx";

const container = document.getElementById("root");
if (!container) {
  throw new Error("找不到 #root 容器。");
}

createRoot(container).render(
  <React.StrictMode>
    <PersonalFinanceCashflowSimulator />
  </React.StrictMode>,
);
