import React from "react";

export default function WorkflowDiagram() {
  return (
    <div className="workflow-diagram" aria-hidden>
      <div className="flow-row">
        <span>ERP</span>
        <span>→</span>
        <span>CRM</span>
        <span>→</span>
        <span>WhatsApp</span>
        <span>→</span>
        <span>Inventory</span>
        <span>→</span>
        <span>Finance</span>
        <span>→</span>
        <strong>Celo PayGrid</strong>
      </div>
    </div>
  );
}
