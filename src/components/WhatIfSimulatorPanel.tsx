import React, { useState } from 'react';
import { MonthlyProjectionPoint, SimulationEvent } from '../core/types';

interface WhatIfSimulatorPanelProps {
  events: SimulationEvent[];
  projection: MonthlyProjectionPoint[];
  onAddEvent: (event: Omit<SimulationEvent, 'id'>) => void;
  onRemoveEvent: (id: string) => void;
  onReset: () => void;
}

export const WhatIfSimulatorPanel: React.FC<WhatIfSimulatorPanelProps> = ({
  events,
  projection,
  onAddEvent,
  onRemoveEvent,
  onReset,
}) => {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<SimulationEvent['type']>('recurring_expense');
  const [amount, setAmount] = useState('');
  const [startOffset, setStartOffset] = useState(1);
  const [duration, setDuration] = useState(12);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!label.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

    onAddEvent({
      label: label.trim(),
      type,
      amount: numericAmount,
      start_month_offset: startOffset,
      duration_months: type === 'one_time_expense' ? 1 : duration,
    });

    setLabel('');
    setAmount('');
  };

  const finalPoint = projection[projection.length - 1];
  const delta12m = finalPoint
    ? finalPoint.simulated_cumulative - finalPoint.baseline_cumulative
    : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Simulador Financeiro "E se..." (12 Meses)
          </h3>
          <p className="text-xs text-slate-500">
            Ambiente isolado em memória — não altera os saldos nem os dados reais do casal.
          </p>
        </div>
        {events.length > 0 && (
          <button
            onClick={onReset}
            className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
          >
            Limpar Cenário
          </button>
        )}
      </div>

      {/* Add Hypothetical Event Form */}
      <form onSubmit={handleAdd} className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-5">
        <input
          type="text"
          placeholder="Ex: Prestação Carro / Férias"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs sm:col-span-2 dark:border-slate-700 dark:bg-slate-800"
        />

        <select
          value={type}
          onChange={(e) => setType(e.target.value as SimulationEvent['type'])}
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
        >
          <option value="recurring_expense">Despesa Mensal</option>
          <option value="one_time_expense">Despesa Única</option>
          <option value="extra_income">Receita Extra</option>
        </select>

        <input
          type="number"
          step="0.01"
          placeholder="Valor (€)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
        />

        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
        >
          + Simular
        </button>
      </form>

      {/* Active Simulated Events Pills */}
      {events.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {events.map((ev) => (
            <span
              key={ev.id}
              className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              {ev.label}: {ev.type === 'extra_income' ? '+' : '-'}
              {ev.amount.toFixed(0)}€ ({ev.duration_months}m)
              <button
                onClick={() => onRemoveEvent(ev.id)}
                className="text-indigo-400 hover:text-indigo-700"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 12-Month Impact Summary Banner */}
      {finalPoint && (
        <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
          <div>
            <span className="block text-slate-500">Poupança Atual (12m)</span>
            <strong className="text-sm font-semibold text-slate-900 dark:text-white">
              {finalPoint.baseline_cumulative.toFixed(2)} €
            </strong>
          </div>
          <div>
            <span className="block text-slate-500">Cenário Simulado (12m)</span>
            <strong className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              {finalPoint.simulated_cumulative.toFixed(2)} €
            </strong>
          </div>
          <div>
            <span className="block text-slate-500">Diferença Acumulada</span>
            <strong
              className={`text-sm font-semibold ${
                delta12m >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {delta12m >= 0 ? '+' : ''}
              {delta12m.toFixed(2)} €
            </strong>
          </div>
        </div>
      )}

      {/* Compact Monthly Comparison Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b text-slate-500 dark:border-slate-800">
            <tr>
              <th className="py-2">Mês</th>
              <th className="py-2 text-right">Poupança Base</th>
              <th className="py-2 text-right">Poupança Simulada</th>
              <th className="py-2 text-right">Acumulado Simulado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {projection.map((row, idx) => (
              <tr key={idx}>
                <td className="py-1.5 font-medium">{row.month_label}</td>
                <td className="py-1.5 text-right text-slate-500">
                  {row.baseline_savings.toFixed(2)} €
                </td>
                <td
                  className={`py-1.5 text-right font-medium ${
                    row.simulated_savings < row.baseline_savings
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {row.simulated_savings.toFixed(2)} €
                </td>
                <td className="py-1.5 text-right font-semibold">
                  {row.simulated_cumulative.toFixed(2)} €
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
