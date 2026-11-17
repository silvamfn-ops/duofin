import {
  AutoRule,
  BankImportProfile,
  ImportedTransactionCandidate,
  Transaction,
} from './types';
import { RuleEngine } from './ruleEngine';

export const DEFAULT_PT_BANK_PROFILES: BankImportProfile[] = [
  {
    id: 'prof_cgd',
    bank_name: 'Caixa Geral de Depósitos (CGD)',
    delimiter: ';',
    date_col: 0,
    date_format: 'DD-MM-YYYY',
    desc_col: 2,
    amount_col: 3,
    decimal_separator: ',',
    skip_rows: 1,
  },
  {
    id: 'prof_millennium',
    bank_name: 'Millennium BCP / ActivoBank',
    delimiter: ';',
    date_col: 0,
    date_format: 'DD/MM/YYYY',
    desc_col: 2,
    amount_col: 3,
    decimal_separator: ',',
    skip_rows: 1,
  },
  {
    id: 'prof_revolut',
    bank_name: 'Revolut (EUR)',
    delimiter: ',',
    date_col: 2,
    date_format: 'YYYY-MM-DD',
    desc_col: 4,
    amount_col: 5,
    decimal_separator: '.',
    skip_rows: 1,
  },
];

export class BankImporter {
  static parseDateToISO(raw: string, format: BankImportProfile['date_format']): string {
    const clean = raw.trim().split(' ')[0]; // Strip time if present
    const parts = clean.split(/[\/\-]/);
    if (parts.length !== 3) return clean;

    if (format === 'YYYY-MM-DD') {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    // DD-MM-YYYY or DD/MM/YYYY
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }

  static parseAmount(raw: string, decimalSeparator: ',' | '.'): number {
    let clean = raw.replace(/[^0-9,\.-]/g, '');
    if (decimalSeparator === ',') {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
    return parseFloat(clean) || 0;
  }

  static computeHash(isoDate: string, amount: number, description: string): string {
    const normDesc = RuleEngine.normalize(description).slice(0, 12);
    return `${isoDate}_${amount.toFixed(2)}_${normDesc}`;
  }

  static daysBetween(isoA: string, isoB: string): number {
    const msA = Date.parse(isoA);
    const msB = Date.parse(isoB);
    if (isNaN(msA) || isNaN(msB)) return 999;
    return Math.abs(Math.round((msA - msB) / (1000 * 60 * 60 * 24)));
  }

  /**
   * Parses raw CSV string client-side, applies categorization rules,
   * and detects exact or probable duplicates against existing transactions.
   */
  static parseCSV(
    csvContent: string,
    profile: BankImportProfile,
    existingTransactions: Transaction[],
    rules: AutoRule[]
  ): ImportedTransactionCandidate[] {
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const dataLines = lines.slice(profile.skip_rows);
    const candidates: ImportedTransactionCandidate[] = [];

    for (const line of dataLines) {
      const cols = line.split(profile.delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
      if (cols.length <= Math.max(profile.date_col, profile.desc_col, profile.amount_col)) {
        continue;
      }

      const rawDate = cols[profile.date_col];
      const isoDate = this.parseDateToISO(rawDate, profile.date_format);
      const description = cols[profile.desc_col];
      const amount = this.parseAmount(cols[profile.amount_col], profile.decimal_separator);

      if (!description || amount === 0) continue;

      const hash = this.computeHash(isoDate, amount, description);
      const matchedRule = RuleEngine.matchRule(description, rules);

      // Duplicate Detection
      let duplicateStatus: ImportedTransactionCandidate['duplicate_status'] = 'none';
      let duplicateMatchId: string | undefined;

      for (const existing of existingTransactions) {
        if (existing.import_hash === hash) {
          duplicateStatus = 'exact';
          duplicateMatchId = existing.id;
          break;
        }

        const sameAmount = Math.abs(existing.amount - amount) < 0.005;
        if (sameAmount) {
          const diffDays = this.daysBetween(existing.date, isoDate);
          if (diffDays === 0) {
            duplicateStatus = 'exact';
            duplicateMatchId = existing.id;
            break;
          } else if (diffDays <= 3 && duplicateStatus === 'none') {
            duplicateStatus = 'probable';
            duplicateMatchId = existing.id;
          }
        }
      }

      candidates.push({
        raw_date: rawDate,
        iso_date: isoDate,
        description,
        amount,
        suggested_category_id: matchedRule ? matchedRule.category_id : null,
        suggested_split_mode: matchedRule ? matchedRule.split_mode : '50_50',
        matched_rule_id: matchedRule ? matchedRule.id : null,
        duplicate_status: duplicateStatus,
        duplicate_match_id: duplicateMatchId,
        import_hash: hash,
      });
    }

    return candidates;
  }
}
