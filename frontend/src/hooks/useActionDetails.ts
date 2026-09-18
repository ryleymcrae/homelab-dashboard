import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ConfirmableAction, HostAction, ServiceAction } from "../api/types";

/**
 * Fetches a target's *real* declared action (with its actual
 * confirm_title/confirm_body/requireTypedConfirmation) rather than
 * fabricating confirm text client-side -- used anywhere a control
 * points at an action it doesn't itself own: an alert's suggested
 * action, a Home page custom card's linked action. Returns null while
 * loading, on failure, or if the target no longer advertises that
 * action kind (e.g. it was removed from config.yml) -- callers should
 * hide the button in that case rather than show a button that can't work.
 */
export function useActionDetails(
  targetType: "service" | "host" | null | undefined,
  targetId: string | null | undefined,
  actionKind: string | null | undefined
): ConfirmableAction | null {
  const [action, setAction] = useState<ConfirmableAction | null>(null);

  useEffect(() => {
    setAction(null);
    if (!targetType || !targetId || !actionKind) return;
    let cancelled = false;
    const load =
      targetType === "service"
        ? api.getService(targetId).then((s) => s.actions.find((a) => a.kind === actionKind))
        : api.getHost(targetId).then((h) => h.actions.find((a) => a.kind === actionKind));
    load
      .then((found) => !cancelled && setAction((found as ServiceAction | HostAction | undefined) ?? null))
      .catch(() => !cancelled && setAction(null));
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, actionKind]);

  return action;
}
