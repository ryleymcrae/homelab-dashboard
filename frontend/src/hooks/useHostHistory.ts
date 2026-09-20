import { useEffect, useState } from "react";
import { api } from "../api/client";

/** A host's recent CPU/memory history for sparklines. Skipped entirely
 * when nothing on screen draws one (`enabled` false) -- no point asking
 * the backend for data a Number/Radial tile won't use. */
export function useHostHistory(hostId: string, enabled: boolean, hours = 6): { cpu: number[]; mem: number[] } {
  const [history, setHistory] = useState<{ cpu: number[]; mem: number[] }>({ cpu: [], mem: [] });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([api.getHistory(`host.${hostId}.cpu`, hours), api.getHistory(`host.${hostId}.mem`, hours)])
      .then(([cpu, mem]) => {
        if (!cancelled) setHistory({ cpu: cpu.points.map((p) => p.value), mem: mem.points.map((p) => p.value) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hostId, enabled, hours]);

  return history;
}
