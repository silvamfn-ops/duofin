import { useState, useMemo, useCallback } from 'react';

export interface BudgetAlertItem {
  id: string; // e.g. "cat_supermercados_exceeded" or "cat_habitacao_warning"
  category_id: string;
  level: 'warning' | 'exceeded';
  message: string;
}

export interface CycleAlertDismissals {
  cycle_key: string; // e.g. "2026-11"
  dismissed_alert_ids: string[];
}

export function useBudgetAlerts(params: {
  alerts: BudgetAlertItem[];
  currentCycleKey: string;
  persistedCycleDismissals: CycleAlertDismissals;
  onSaveCycleDismissals: (updated: CycleAlertDismissals) => void;
}) {
  const {
    alerts,
    currentCycleKey,
    persistedCycleDismissals,
    onSaveCycleDismissals,
  } = params;

  // Session-only dismissed IDs (cleared on page reload / next app open)
  const [sessionDismissedIds, setSessionDismissedIds] = useState<Set<string>>(
    () => new Set()
  );

  // Active cycle dismissed IDs (reset automatically when cycle_key changes)
  const cycleDismissedSet = useMemo(() => {
    if (persistedCycleDismissals.cycle_key !== currentCycleKey) {
      return new Set<string>();
    }
    return new Set(persistedCycleDismissals.dismissed_alert_ids);
  }, [persistedCycleDismissals, currentCycleKey]);

  const visibleAlerts = useMemo(() => {
    return alerts.filter(
      (a) => !sessionDismissedIds.has(a.id) && !cycleDismissedSet.has(a.id)
    );
  }, [alerts, sessionDismissedIds, cycleDismissedSet]);

  const hiddenCount = alerts.length - visibleAlerts.length;

  /**
   * Dismiss only for the current session (reappears next time the app opens)
   */
  const dismissForSession = useCallback((alertId: string) => {
    setSessionDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      return next;
    });
  }, []);

  /**
   * Dismiss until the next billing cycle (persisted in encrypted state)
   */
  const dismissUntilNextCycle = useCallback(
    (alertId: string) => {
      const currentList =
        persistedCycleDismissals.cycle_key === currentCycleKey
          ? persistedCycleDismissals.dismissed_alert_ids
          : [];

      if (currentList.includes(alertId)) return;

      onSaveCycleDismissals({
        cycle_key: currentCycleKey,
        dismissed_alert_ids: [...currentList, alertId],
      });
    },
    [persistedCycleDismissals, currentCycleKey, onSaveCycleDismissals]
  );

  /**
   * Restore all hidden alerts (both session and current cycle)
   */
  const restoreAllAlerts = useCallback(() => {
    setSessionDismissedIds(new Set());
    onSaveCycleDismissals({
      cycle_key: currentCycleKey,
      dismissed_alert_ids: [],
    });
  }, [currentCycleKey, onSaveCycleDismissals]);

  return {
    visibleAlerts,
    hiddenCount,
    dismissForSession,
    dismissUntilNextCycle,
    restoreAllAlerts,
  };
}
