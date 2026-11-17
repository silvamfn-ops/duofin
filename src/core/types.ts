export type SplitMode = '50_50' | 'proportional' | '100_payer' | 'custom';
export type MatchType = 'contains' | 'exact' | 'starts_with';
export type RolloverDestination = 'same_category' | 'savings_goal';

export interface AutoRule {
  id: string;
  pattern: string;
  match_type: MatchType;
  category_id: string;
  split_mode: SplitMode;
  custom_split_ratio?: number | null; // e.g. 0.6 for 60% payer / 40% partner
  priority: number;
  active: boolean;
}

export interface BankImportProfile {
  id: string;
  bank_name: string;
  delimiter: string;
  date_col: number;
  date_format: 'DD-MM-YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  desc_col: number;
  amount_col: number;
  decimal_separator: ',' | '.';
  skip_rows: number;
}

export interface BudgetV2 {
  category_id: string;
  monthly_limit: number;
  rollover_enabled: boolean;
  rollover_destination: RolloverDestination;
  target_goal_id?: string | null;
  accumulated_rollover: number;
}

export interface Transaction {
  id: string;
  date: string; // ISO YYYY-MM-DD
  description: string;
  amount: number; // Negative for expense, positive for income
  category_id: string;
  payer_id: string;
  split_mode: SplitMode;
  custom_split_ratio?: number | null;
  is_recurring?: boolean;
  is_extraordinary?: boolean;
  import_hash?: string;
}

export interface ImportedTransactionCandidate {
  raw_date: string;
  iso_date: string;
  description: string;
  amount: number;
  suggested_category_id: string | null;
  suggested_split_mode: SplitMode;
  matched_rule_id: string | null;
  duplicate_status: 'none' | 'probable' | 'exact';
  duplicate_match_id?: string;
  import_hash: string;
}

export interface SimulationEvent {
  id: string;
  label: string;
  type: 'extra_income' | 'one_time_expense' | 'recurring_expense';
  amount: number; // Always positive magnitude
  start_month_offset: number; // 0 = current month, 1 = next month, etc.
  duration_months: number; // 1 for one-time, N for recurring
}

export interface MonthlyProjectionPoint {
  month_label: string;
  baseline_savings: number;
  simulated_savings: number;
  baseline_cumulative: number;
  simulated_cumulative: number;
}
