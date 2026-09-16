"use client";

import nextDynamic from "next/dynamic";

export const CareerGraphView = nextDynamic(
  () => import("@/components/CareerGraph").then((m) => m.CareerGraph),
  {
    ssr: false,
    loading: () => (
      <div className="graph-shell panel flex items-center justify-center text-sm muted">
        Загрузка графа…
      </div>
    ),
  },
);
