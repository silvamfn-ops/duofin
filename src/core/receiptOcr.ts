import { AutoRule } from './types';
import { RuleEngine } from './ruleEngine';

export interface ParsedReceiptData {
  merchant_name: string | null;
  amount: number | null;
  iso_date: string | null;
  suggested_category_id: string | null;
  raw_text: string;
}

/**
 * Extracts total amount, date, and merchant from raw OCR text (Portuguese receipts).
 * Designed to receive output from a local Tesseract.js Web Worker.
 */
export function extractReceiptFields(rawOcrText: string, rules: AutoRule[]): ParsedReceiptData {
  const lines = rawOcrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. Merchant Name: inspect top 3 non-empty lines
  const headerLines = lines.slice(0, 3);
  const merchantName = headerLines.find((l) => l.length >= 3 && !/^\d+$/.test(l)) || null;

  // 2. Date extraction (DD/MM/YYYY or DD-MM-YYYY or YYYY-MM-DD)
  let isoDate: string | null = null;
  const dateRegex = /\b(\d{2})[\/\-](\d{2})[\/\-](20\d{2}|\d{2})\b/;
  for (const line of lines) {
    const match = line.match(dateRegex);
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3].length === 2 ? `20${match[3]}` : match[3];
      isoDate = `${year}-${month}-${day}`;
      break;
    }
  }

  // 3. Total Amount extraction (prioritize lines with TOTAL / A PAGAR / EUR)
  let extractedAmount: number | null = null;
  const totalKeywordRegex = /(TOTAL|A PAGAR|IMPORTE|VALOR A PAGAR|MB|MULTIBANCO).*?(\d+[.,]\d{2})/i;
  const fallbackAmountRegex = /(\d+[.,]\d{2})\s*(EUR|€)?$/i;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    const kwMatch = line.match(totalKeywordRegex);
    if (kwMatch) {
      extractedAmount = parseFloat(kwMatch[2].replace(',', '.'));
      break;
    }
  }

  if (extractedAmount === null) {
    // Fallback: pick the largest monetary amount in the bottom half of the receipt
    const bottomHalf = lines.slice(Math.floor(lines.length / 2));
    let maxVal = 0;
    for (const line of bottomHalf) {
      const m = line.match(fallbackAmountRegex);
      if (m) {
        const val = parseFloat(m[1].replace(',', '.'));
        if (val > maxVal) maxVal = val;
      }
    }
    if (maxVal > 0) extractedAmount = maxVal;
  }

  // 4. Match merchant against existing AutoRules
  let suggestedCategoryId: string | null = null;
  if (merchantName) {
    const matched = RuleEngine.matchRule(merchantName, rules);
    if (matched) suggestedCategoryId = matched.category_id;
  }

  return {
    merchant_name: merchantName,
    amount: extractedAmount,
    iso_date: isoDate,
    suggested_category_id: suggestedCategoryId,
    raw_text: rawOcrText,
  };
}
