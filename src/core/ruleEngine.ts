import { AutoRule, SplitMode, Transaction } from './types';

export class RuleEngine {
  /**
   * Normalizes text to uppercase without diacritics/accents for resilient matching.
   */
  static normalize(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .trim();
  }

  /**
   * Evaluates a description against active rules sorted by priority.
   */
  static matchRule(description: string, rules: AutoRule[]): AutoRule | null {
    const normalizedDesc = this.normalize(description);
    const activeRules = [...rules]
      .filter((r) => r.active)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of activeRules) {
      const normalizedPattern = this.normalize(rule.pattern);
      if (!normalizedPattern) continue;

      switch (rule.match_type) {
        case 'exact':
          if (normalizedDesc === normalizedPattern) return rule;
          break;
        case 'starts_with':
          if (normalizedDesc.startsWith(normalizedPattern)) return rule;
          break;
        case 'contains':
        default:
          if (normalizedDesc.includes(normalizedPattern)) return rule;
          break;
      }
    }

    return null;
  }

  /**
   * Applies matching rule defaults to a new or imported transaction.
   */
  static applyRules<T extends Partial<Transaction>>(
    tx: T,
    rules: AutoRule[]
  ): T & { matched_rule_id: string | null } {
    if (!tx.description) {
      return { ...tx, matched_rule_id: null };
    }

    const matched = this.matchRule(tx.description, rules);
    if (!matched) {
      return { ...tx, matched_rule_id: null };
    }

    return {
      ...tx,
      category_id: matched.category_id,
      split_mode: matched.split_mode,
      custom_split_ratio: matched.custom_split_ratio ?? null,
      matched_rule_id: matched.id,
    };
  }

  /**
   * Extracts a clean keyword suggestion when a user manually categorizes a transaction
   * that had no matching rule, enabling one-tap rule creation.
   */
  static suggestPatternFromDescription(description: string, existingRules: AutoRule[]): string | null {
    if (this.matchRule(description, existingRules)) {
      return null; // Already covered by a rule
    }

    // Strip common POS prefixes, numbers, dates, and store codes
    const cleaned = this.normalize(description)
      .replace(/\b(COMPRA|PAGAMENTO|MB|MULTIBANCO|TPA|TRF|DD|DEBITO DIRETO|LISBOA|PORTO|SINTRA)\b/g, '')
      .replace(/[0-9\/\-\*\#\.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = cleaned.split(' ').filter((t) => t.length >= 3);
    if (tokens.length === 0) return null;

    // Return up to the first two meaningful words (e.g., "PINGO DOCE" or "CONTINENTE")
    return tokens.slice(0, 2).join(' ');
  }
}
