import React from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";

export default function DeckNavigation({
  index,
  setIndex,
  total,
}: {
  index: number;
  setIndex: (n: number | ((x: number) => number)) => void;
  total: number;
}) {
  return (
    <div className="deck-nav">
      <button
        onClick={() => setIndex((i: number) => Math.max(0, i - 1))}
        aria-label="Previous slide"
        className="magnetic"
      >
        <ChevronLeft size={18} />
        Prev
      </button>
      <div className="nav-center">
        <span>
          Slide {index + 1} / {total}
        </span>
      </div>
      <button
        onClick={() => setIndex((i: number) => Math.min(total - 1, i + 1))}
        aria-label="Next slide"
        className="primary-action magnetic"
      >
        Next
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
