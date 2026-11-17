# DuoFin v6.5 / v7.0 — Core Intelligence & Planning Modules

Módulos TypeScript 100% *client-side* (compatíveis com armazenamento local-first e encriptação ponta-a-ponta E2EE) prontos a integrar no repositório da **DuoFin**.

## Estrutura incluída

- `src/core/types.ts` — Modelos de dados (`AutoRule`, `BankImportProfile`, `BudgetV2`, `SimulationEvent`).
- `src/core/ruleEngine.ts` — Motor de categorização automática por prioridade e sugestão passiva de regras.
- `src/core/bankImporter.ts` — Parser CSV com perfis pré-configurados (CGD, Millennium/ActivoBank, Revolut) e deteção de duplicados exatos e prováveis (±3 dias).
- `src/core/receiptOcr.ts` — Extrator de total, data e comerciante para texto OCR de talões portugueses (Tesseract.js).
- `src/core/financialForecast.ts` — Projeção de saldo de fim de mês, motor de *rollover* de orçamentos e simulador financeiro *"E se..."* a 12 meses.

## Integração rápida

```ts
import {
  RuleEngine,
  BankImporter,
  DEFAULT_PT_BANK_PROFILES,
  FinancialPlanner,
} from './core';

// 1. Aplicar regras automáticas numa nova transação
const categorizedTx = RuleEngine.applyRules(newTx, userAutoRules);

// 2. Importar CSV bancário com deteção de duplicados
const candidates = BankImporter.parseCSV(
  csvRawText,
  DEFAULT_PT_BANK_PROFILES[0],
  existingTransactions,
  userAutoRules
);

// 3. Simular cenário "E se..." a 12 meses
const projection = FinancialPlanner.runWhatIfSimulation({
  startingSavings: 8500,
  baselineMonthlyIncome: 3200,
  baselineMonthlyExpenses: 2450,
  events: [
    {
      id: 'ev_1',
      label: 'Prestação Carro Novo',
      type: 'recurring_expense',
      amount: 260,
      start_month_offset: 1,
      duration_months: 12,
    },
  ],
});
```
