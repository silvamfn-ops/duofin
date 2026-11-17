import React from 'react';
import { EndOfMonthForecast } from '../core/financialForecast';

interface EndOfMonthForecastCardProps {
  forecast: EndOfMonthForecast;
  totalActiveRollover: number;
  privacyMode?: boolean;
}

export const EndOfMonthForecastCard: React.FC<EndOfMonthForecastCardProps> = ({
  forecast,
  totalActiveRollover,
  privacyMode = false,
}) => {
  const formatCurrency = (val: number) =>
    privacyMode ? '•••• €' : `${val.toFixed(2)} €`;

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm transition-colors ${
        forecast.liquidity_alert
          ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Previsão de Fecho do Mês
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-xl font-bold ${
                forecast.liquidity_alert
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {formatCurrency(forecast.projected_end_balance)}
            </span>
            <span className="text-xs text-slate-500">estimados no dia 30/31</span>
          </div>
        </div>

        {forecast.liquidity_alert ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            ⚠ Alerta de Liquidez
          </span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
            ✓ Ritmo Saudável
          </span>
        )}
      </div>

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
