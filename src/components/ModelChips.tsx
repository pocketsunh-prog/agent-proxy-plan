"use client";

import type { ModelDTO } from "@/lib/catalog";

interface Props {
  models: ModelDTO[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function ModelChips({ models, selectedId, onSelect }: Props) {
  return (
    <div className="model-chips">
      {models.map((m) => (
        <button
          key={m.id}
          type="button"
          className={"chip" + (m.id === selectedId ? " selected" : "")}
          onClick={() => onSelect(m.id)}
        >
          {m.displayName}
        </button>
      ))}
    </div>
  );
}
