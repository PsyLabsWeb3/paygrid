import React from "react";

export default function SlideProgress({
  index,
  total,
}: {
  index: number;
  total: number;
}) {
  const pct = Math.round(((index + 1) / total) * 100);
  return (
    <div className="slide-progress">
      <div className="progress-bar" aria-hidden>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <small>
        Slide {index + 1} of {total}
      </small>
    </div>
  );
}
