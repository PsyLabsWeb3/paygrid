import React from "react";

export default function DistributionNetwork() {
  return (
    <div className="distribution-network" aria-hidden>
      <div className="network-legend">
        <span>PayGrid</span>
        <span>Yacamba</span>
        <span>Agents</span>
        <span>Businesses</span>
        <span>Customers</span>
      </div>
      <div className="network-graph">
        <svg
          width="100%"
          height="100"
          viewBox="0 0 600 100"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-hidden
        >
          <g fill="none" stroke="#b7ff1a" strokeWidth="2">
            <circle cx="50" cy="56" r="8" fill="#b7ff1a" />
            <circle cx="175" cy="28" r="6" fill="#b7ff1a" />
            <circle cx="300" cy="56" r="6" fill="#b7ff1a" />
            <circle cx="425" cy="28" r="6" fill="#b7ff1a" />
            <circle cx="550" cy="56" r="8" fill="#b7ff1a" />
            <path d="M58 56 L169 30" />
            <path d="M181 30 L294 56" />
            <path d="M306 56 L419 30" />
            <path d="M431 30 L542 56" />
          </g>
        </svg>
      </div>
    </div>
  );
}
