import React, { useState } from 'react';
import { EndOfMonthForecast } from '../core/financialForecast';
import { SummaryAlertSettings } from '../core/types';

interface EndOfMonthForecastCardProps {
  forecast: EndOfMonthForecast;
  totalActiveRollover: number;
  currentMonthKey: string; // e.g. "2026-11"
  alertSettings: SummaryAlertSettings;
  onUpdateAlertSettings: (updated: SummaryAlertSettings) => void;
  privacyMode?: boolean;
}

export const EndOfMonthForecastCard: React.FC<EndOfMonthForecastCardProps> = ({
  forecast,
  totalActiveRollover,
  currentMonthKey,
  alertSettings,
  onUpdateAlertSettings,
  privacyMode = false,
}) => {
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  const formatCurrency = (val: number) =>
    privacyMode ? '•••• €' : `${val.toFixed(2)} €`;

  const isDismissedThisMonth = alertSettings.dismissed_for_month === currentMonthKey;
  const shouldShowAlert =
    forecast.liquidity_alert &&
    alertSettings.liquidity_alert_enabled &&
    !isDismissedThisMonth;

  // Compact banner when the card itself is hidden in the Summary tab
  if (!alertSettings.show_forecast_card) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/50">
        <span>Previsão de fecho do mês oculta no Resumo.</span>
        <button
          type="button"
          onClick={() =>
            onUpdateAlertSettings({ ...alertSettings, show_forecast_card: true })
          }
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Mostrar cartão
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm transition-colors ${
        shouldShowAlert
          ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      {/* Header with Alert Badge & Quick Controls */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Previsão de Fecho do Mês
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-bold ${
                shouldShowAlert
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {formatCurrency(forecast.projected_end_balance)}
            </span>
            <span className="text-xs text-slate-500">estimados no dia 30/31</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {shouldShowAlert ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
              ⚠ Alerta de Liquidez
            </span>
          ) : !alertSettings.liquidity_alert_enabled || isDismissedThisMonth ? (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              🔕 Alerta Silenciado
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
              ✓ Ritmo Saudável
            </span>
          )}

          {/* Toggle Quick Settings Menu */}
          <button
            type="button"
            title="Configurar visualização e alerta"
            onClick={() => setIsConfigOpen((prev) => !prev)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ⚙️
          </button>
        </div>
      </div>

      {/* Inline Quick Controls for Alert & Card Visibility in Summary Tab */}
      {isConfigOpen && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/80">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-700">
            <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={alertSettings.liquidity_alert_enabled}
                onChange={(e) =>
                  onUpdateAlertSettings({
                    ...alertSettings,
                    liquidity_alert_enabled: e.target.checked,
                    dismissed_for_month: e.target.checked ? null : alertSettings.dismissed_for_month,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
              />
              Ativar alerta de liquidez no Resumo
            </label>

            {shouldShowAlert && (
              <button
                type="button"
                onClick={() =>
                  onUpdateAlertSettings({
                    ...alertSettings,
                    dismissed_for_month: currentMonthKey,
                  })
                }
                className="rounded-md bg-amber-200/70 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/50 dark:text-amber-200"
              >
                Silenciar este mês
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Limite mínimo (€):</span>
              <input
                type="number"
                step="10"
                value={alertSettings.minimum_safe_balance}
                onChange={(e) =>
                  onUpdateAlertSettings({
                    ...alertSettings,
                    minimum_safe_balance: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-20 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setIsConfigOpen(false);
                onUpdateAlertSettings({ ...alertSettings, show_forecast_card: false });
              }}
              className="text-[11px] font-medium text-slate-500 hover:text-rose-600"
            >
              Ocultar cartão do Resumo
            </button>
          </div>
        </div>
      )}

      {/* Metrics Footer */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
        <div>
          <span className="block text-[11px] text-slate-500">Fixas Pendentes</span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            -{formatCurrency(forecast.pending_recurring_expenses)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-500">Média Variável/Dia</span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">
            {formatCurrency(forecast.daily_variable_burn_rate)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] text-slate-500">Bónus Rollover</span>
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
            +{formatCurrency(totalActiveRollover)}
          </span>
        </div>
      </div>
    </div>
  );
};
