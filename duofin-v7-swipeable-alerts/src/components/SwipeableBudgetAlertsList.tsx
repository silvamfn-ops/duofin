import React, { useRef, useState } from 'react';
import { BudgetAlertItem } from '../hooks/useBudgetAlerts';

interface SwipeableBudgetAlertsListProps {
  alerts: BudgetAlertItem[];
  hiddenCount: number;
  onDismissSession: (id: string) => void;
  onDismissCycle: (id: string) => void;
  onRestoreAll: () => void;
}

interface SwipeableAlertRowProps {
  alert: BudgetAlertItem;
  onDismissSession: (id: string) => void;
  onDismissCycle: (id: string) => void;
}

const SwipeableAlertRow: React.FC<SwipeableAlertRowProps> = ({
  alert,
  onDismissSession,
  onDismissCycle,
}) => {
  const [translateX, setTranslateX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showChoice, setShowChoice] = useState(false);
  const startXRef = useRef<number | null>(null);

  const SWIPE_THRESHOLD = 75;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (showChoice) return;
    startXRef.current = e.clientX;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || startXRef.current === null) return;
    const deltaX = e.clientX - startXRef.current;
    // Allow swiping left or right up to 140px
    const clamped = Math.max(-140, Math.min(140, deltaX));
    setTranslateX(clamped);
  };

  const handlePointerUp = () => {
    if (!isDragging) return;
    setIsDragging(false);

    if (Math.abs(translateX) >= SWIPE_THRESHOLD) {
      // Snap open to reveal the 2 clean choices: "Só agora" vs "Até próx. ciclo"
      setShowChoice(true);
      setTranslateX(0);
    } else {
      setTranslateX(0);
    }
    startXRef.current = null;
  };

  const isExceeded = alert.level === 'exceeded';

  // Color palette matching DuoFin dark theme screenshot
  const cardStyle = isExceeded
    ? 'bg-[#362229] border-[#52303b] text-[#f3cfd6]'
    : 'bg-[#3b3322] border-[#594c30] text-[#f5e3b8]';

  if (showChoice) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-[#192334] px-3 py-2.5 text-xs shadow-sm transition-all">
        <span className="truncate text-slate-300 font-medium">
          Ocultar alerta:
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onDismissSession(alert.id)}
            className="rounded-lg bg-slate-700/80 px-2.5 py-1.5 font-medium text-slate-100 hover:bg-slate-600 active:scale-95"
          >
            Só agora
          </button>
          <button
            type="button"
            onClick={() => onDismissCycle(alert.id)}
            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 font-medium text-white hover:bg-indigo-500 active:scale-95"
          >
            Até próx. ciclo
          </button>
          <button
            type="button"
            aria-label="Cancelar"
            onClick={() => setShowChoice(false)}
            className="ml-0.5 rounded-lg px-2 py-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl select-none touch-pan-y">
      {/* Background hint revealed while dragging */}
      <div className="absolute inset-0 flex items-center justify-between rounded-xl bg-slate-800/90 px-4 text-xs font-medium text-slate-300">
        <span>← Deslizar para ocultar</span>
        <span>Deslizar para ocultar →</span>
      </div>

      {/* Foreground Swipeable Pill */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
        }}
        className={`relative flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] leading-snug cursor-grab active:cursor-grabbing ${cardStyle}`}
      >
        <div className="flex items-start gap-2">
          {isExceeded && <span className="mt-0.5 text-xs">⚠</span>}
          <span>{alert.message}</span>
        </div>

        {/* Subtle tap fallback button for desktop/accessibility */}
        <button
          type="button"
          title="Opções de ocultar alerta"
          onClick={(e) => {
            e.stopPropagation();
            setShowChoice(true);
          }}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs opacity-60 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export const SwipeableBudgetAlertsList: React.FC<SwipeableBudgetAlertsListProps> = ({
  alerts,
  hiddenCount,
  onDismissSession,
  onDismissCycle,
  onRestoreAll,
}) => {
  if (alerts.length === 0 && hiddenCount === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <SwipeableAlertRow
          key={alert.id}
          alert={alert}
          onDismissSession={onDismissSession}
          onDismissCycle={onDismissCycle}
        />
      ))}

      {/* Subtle footer pill to restore dismissed alerts if needed */}
      {hiddenCount > 0 && (
        <div className="flex items-center justify-between px-1 pt-0.5 text-[11px] text-slate-400">
          <span>
            {hiddenCount === 1
              ? '1 alerta oculto'
              : `${hiddenCount} alertas ocultos`}
          </span>
          <button
            type="button"
            onClick={onRestoreAll}
            className="font-medium text-indigo-400 hover:text-indigo-300 hover:underline"
          >
            Repor alertas
          </button>
        </div>
      )}
    </div>
  );
};
