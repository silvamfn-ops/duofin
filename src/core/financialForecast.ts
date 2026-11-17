import {
  BudgetV2,
  MonthlyProjectionPoint,
  SimulationEvent,
  Transaction,
} from './types';

export interface EndOfMonthForecast {
  current_balance: number;
  pending_recurring_expenses: number;
  daily_variable_burn_rate: number;
  projected_variable_remaining: number;
  projected_end_balance: number;
  liquidity_alert: boolean;
}

export class FinancialPlanner {
  /**
   * Calculates end-of-month balance projection based on current balance,
   * scheduled recurring bills, and current variable burn rate.
   */
  static forecastEndOfMonth(params: {
    currentBalance: number;
    currentDayOfMonth: number;
    totalDaysInMonth: number;
    monthTransactions: Transaction[];
    pendingRecurringAmount: number;
    minimumSafeBalance?: number;
  }): EndOfMonthForecast {
    const {
      currentBalance,
      currentDayOfMonth,
      totalDaysInMonth,
      monthTransactions,
      pendingRecurringAmount,
      minimumSafeBalance = 0,
    } = params;

    const elapsedDays = Math.max(1, currentDayOfMonth);
    const remainingDays = Math.max(0, totalDaysInMonth - currentDayOfMonth);

    // Sum variable expenses only (exclude income, recurring, and extraordinary items)
    const variableSpent = monthTransactions
      .filter((t) => t.amount < 0 && !t.is_recurring && !t.is_extraordinary)
      .reduce((acc, t) => acc + Math.abs(t.amount), 0);

    const dailyBurnRate = variableSpent / elapsedDays;
    const projectedVariableRemaining = dailyBurnRate * remainingDays;
    const projectedEndBalance =
      currentBalance - pendingRecurringAmount - projectedVariableRemaining;

    return {
      current_balance: Number(currentBalance.toFixed(2)),
      pending_recurring_expenses: Number(pendingRecurringAmount.toFixed(2)),
      daily_variable_burn_rate: Number(dailyBurnRate.toFixed(2)),
      projected_variable_remaining: Number(projectedVariableRemaining.toFixed(2)),
      projected_end_balance: Number(projectedEndBalance.toFixed(2)),
      liquidity_alert: projectedEndBalance < minimumSafeBalance,
    };
  }

  /**
   * Computes month-end budget rollover adjustments for flexible categories.
   */
  static processMonthlyRollovers(
    budgets: BudgetV2[],
    previousMonthExpensesByCategory: Record<string, number>,
    carryNegativeBalance = false
  ): {
    updatedBudgets: BudgetV2[];
    goalTransfers: Array<{ goal_id: string; amount: number; source_category_id: string }>;
  } {
    const goalTransfers: Array<{ goal_id: string; amount: number; source_category_id: string }> = [];

    const updatedBudgets = budgets.map((budget) => {
      if (!budget.rollover_enabled) {
        return { ...budget, accumulated_rollover: 0 };
      }

      const spent = Math.abs(previousMonthExpensesByCategory[budget.category_id] || 0);
      const effectiveLimit = budget.monthly_limit + budget.accumulated_rollover;
      const remainder = effectiveLimit - spent;

      if (remainder > 0) {
        if (budget.rollover_destination === 'savings_goal' && budget.target_goal_id) {
          goalTransfers.push({
            goal_id: budget.target_goal_id,
            amount: Number(remainder.toFixed(2)),
            source_category_id: budget.category_id,
          });
          return { ...budget, accumulated_rollover: 0 };
        }
        return {
          ...budget,
          accumulated_rollover: Number(remainder.toFixed(2)),
        };
      }

      // Overspent
      return {
        ...budget,
        accumulated_rollover: carryNegativeBalance ? Number(remainder.toFixed(2)) : 0,
      };
    });

    return { updatedBudgets, goalTransfers };
  }

  /**
   * Runs a 12-month isolated "What-If" simulation comparing the couple's
   * baseline monthly net savings against hypothetical financial events.
   */
  static runWhatIfSimulation(params: {
    startingSavings: number;
    baselineMonthlyIncome: number;
    baselineMonthlyExpenses: number;
    events: SimulationEvent[];
    monthsHorizon?: number;
    startMonthIndex?: number; // 0 = Jan, 11 = Dec
  }): MonthlyProjectionPoint[] {
    const {
      startingSavings,
      baselineMonthlyIncome,
      baselineMonthlyExpenses,
      events,
      monthsHorizon = 12,
      startMonthIndex = new Date().getMonth(),
    } = params;

    const monthNames = [
      'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
      'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
    ];

    const baselineNet = baselineMonthlyIncome - baselineMonthlyExpenses;
    let baselineCumulative = startingSavings;
    let simulatedCumulative = startingSavings;

    const timeline: MonthlyProjectionPoint[] = [];

    for (let offset = 0; offset < monthsHorizon; offset++) {
      let eventDelta = 0;

      for (const ev of events) {
        const isActiveInMonth =
          offset >= ev.start_month_offset &&
          offset < ev.start_month_offset + ev.duration_months;

        if (isActiveInMonth) {
          if (ev.type === 'extra_income') {
            eventDelta += ev.amount;
          } else {
            eventDelta -= ev.amount;
          }
        }
      }

      const simulatedNet = baselineNet + eventDelta;
      baselineCumulative += baselineNet;
      simulatedCumulative += simulatedNet;

      const label = monthNames[(startMonthIndex + offset) % 12];

      timeline.push({
        month_label: label,
        baseline_savings: Number(baselineNet.toFixed(2)),
        simulated_savings: Number(simulatedNet.toFixed(2)),
        baseline_cumulative: Number(baselineCumulative.toFixed(2)),
        simulated_cumulative: Number(simulatedCumulative.toFixed(2)),
      });
    }

    return timeline;
  }
}
