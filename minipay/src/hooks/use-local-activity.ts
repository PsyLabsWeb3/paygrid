"use client";

import { useEffect, useState } from "react";
import { getLocalActivity, type LocalActivityItem } from "@/lib/local-activity";

export function useLocalActivity() {
  const [items, setItems] = useState<LocalActivityItem[]>([]);

  useEffect(() => {
    setItems(getLocalActivity());
  }, []);

  return { items };
}
