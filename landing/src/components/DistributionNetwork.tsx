import React from "react";

export default function DistributionNetwork() {
  return (
    <div className="distribution-network" aria-hidden>
      <div className="network-legend">
        <span>Celo PayGrid</span>
        <span>→</span>
        <span>Yacamba</span>
        <span>→</span>
        <span>business agents</span>
        <span>→</span>
        <span>companies</span>
        <span>→</span>
        <span>customers</span>+{" "}
      </div>
      +{" "}
      <div className="network-graph">
        + {/* simple accessible SVG fallback */}+{" "}
        <svg
          width="100%"
          height="120"
          viewBox="0 0 600 120"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-hidden
        >
          +{" "}
          <g fill="none" stroke="#b7ff1a" strokeWidth="2">
            + <circle cx="40" cy="60" r="8" fill="#b7ff1a" />
            + <circle cx="160" cy="30" r="6" fill="#b7ff1a" />
            + <circle cx="280" cy="60" r="6" fill="#b7ff1a" />
            + <circle cx="400" cy="30" r="6" fill="#b7ff1a" />
            + <circle cx="520" cy="60" r="8" fill="#b7ff1a" />
            + <path d="M48 60 L154 32" />
            + <path d="M166 32 L274 60" />
            + <path d="M286 60 L394 32" />
            + <path d="M406 32 L512 60" />+{" "}
          </g>
          +{" "}
        </svg>
        +{" "}
      </div>
    </div>
  );
}
