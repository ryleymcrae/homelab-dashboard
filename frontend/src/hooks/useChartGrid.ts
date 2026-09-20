import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "./AuthContext";
import { useSnapshot } from "./SnapshotContext";

/**
 * dashboard.chart_grid for a chart's own Grid toggle -- the same setting
 * as Settings > Appearance, not a separate per-chart preference. Flips
 * immediately, then follows the snapshot once it catches up. No setter
 * under guest mode: the PATCH would only be refused.
 */
export function useChartGrid(): [boolean, ((on: boolean) => void) | undefined] {
  const { snapshot } = useSnapshot();
  const { canAct } = useAuth();
  const saved = snapshot?.dashboard.chartGrid ?? true;
  const [pending, setPending] = useState<boolean | null>(null);

  useEffect(() => setPending(null), [saved]);

  const set = (on: boolean) => {
    setPending(on);
    api.patchConfig({ dashboard: { chart_grid: on } }).catch(() => setPending(null));
  };
  return [pending ?? saved, canAct ? set : undefined];
}
