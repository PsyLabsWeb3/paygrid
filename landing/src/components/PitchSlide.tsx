import React from "react";
import { slides } from "./pitchDeckData";
import WorkflowDiagram from "./WorkflowDiagram";
import PaymentIntentGrid from "./PaymentIntentGrid";
import RoadmapCards from "./RoadmapCards";
import DistributionNetwork from "./DistributionNetwork";

export default function PitchSlide({
  slide,
}: {
  slide: (typeof slides)[number];
}) {
  return (
    <article className="pitch-slide panel-card">
      <header>
        <h3>{slide.title}</h3>
        {slide.subtitle ? <p className="subhead">{slide.subtitle}</p> : null}
        {slide.badges ? (
          <div className="badge-row">
            {slide.badges.map((b: string) => (
              <span className="status-badge" key={b}>
                {b}
              </span>
            ))}
          </div>
        ) : null}
      </header>
      <div className="slide-body">
        {slide.body ? <p>{slide.body}</p> : null}
        {slide.steps ? (
          <ol>
            {slide.steps.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        ) : null}
        {slide.columns ? (
          <div className="two-col">
            <ul>
              {slide.columns.left.map((c: string) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <ul>
              {slide.columns.right.map((c: string) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {slide.scene === "workflow" ? <WorkflowDiagram /> : null}
        {slide.scene === "paymentFlow" ? <PaymentIntentGrid /> : null}
        {slide.scene === "intents" ? <PaymentIntentGrid compact /> : null}
        {slide.scene === "distribution" ? <DistributionNetwork /> : null}
        {slide.roadmap ? (
          <RoadmapCards items={slide.roadmap} note={slide.note} />
        ) : null}

        {slide.example ? <blockquote>{slide.example}</blockquote> : null}
        {slide.highlight ? (
          <p className="highlight">{slide.highlight}</p>
        ) : null}
      </div>
      {slide.cta ? (
        <footer className="slide-cta">
          <a className="primary-action" href="#developers">
            Connect Celo PayGrid MCP
          </a>
          <a className="secondary-action" href="#docs">
            Explore the roadmap
          </a>
        </footer>
      ) : null}
    </article>
  );
}
