import React from "react";

export default function RoadmapCards({
  items,
  note,
}: {
  items: { title: string; body: string }[];
  note?: string;
}) {
  return (
    <div className="roadmap-cards">
      <div className="roadmap-note">{note}</div>
      <div className="card-grid">
        {items.map((it) => (
          <article className="panel-card" key={it.title}>
            <h4>{it.title}</h4>
            <p>{it.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
