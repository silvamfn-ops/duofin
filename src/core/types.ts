export type SplitMode = '50_50' | 'proportional' | '100_payer' | 'custom';
export type MatchType = 'contains' | 'exact' | 'starts_with';
export type RolloverDestination = 'same_category' | 'savings_goal';

export interface SummaryAlertSettings {
  show_forecast_card: boolean;        // Visualizar/ocultar cartão de previsão no separador Resumo
  liquidity_alert_enabled: boolean;   // Ativar/desativar aviso visual de alerta de liquidez
  minimum_safe_balance: number;       // Limite mínimo de segurança (€) para disparar o alerta
  dismissed_for_month?: string | null; // Ex: "2026-11" se o casal silenciou o alerta apenas este mês
}

export interface AutoRule {
  id: string;
  pattern: string;
  match_type: MatchType;
  category_id: string;
  split_mode: SplitMode;
  custom_split_ratio?: number | null;
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
  date: string;
  description: string;
  amount: number;
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
  amount: number;
  start_month_offset: number;
  duration_months: number;
}

export interface MonthlyProjectionPoint {
  month_label: string;
  baseline_savings: number;
  simulated_savings: number;
  baseline_cumulative: number;
  simulated_cumulative: number;
}
