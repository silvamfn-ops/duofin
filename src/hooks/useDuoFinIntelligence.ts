import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  AutoRule,
  BankImportProfile,
  BudgetV2,
  ImportedTransactionCandidate,
  SimulationEvent,
  Transaction,
} from '../core/types';
import { RuleEngine } from '../core/ruleEngine';
import { BankImporter, DEFAULT_PT_BANK_PROFILES } from '../core/bankImporter';
import { extractReceiptFields, ParsedReceiptData } from '../core/receiptOcr';
import { FinancialPlanner } from '../core/financialForecast';

/**
 * Hook 1: Auto-Categorization & Passive Rule Learning
 */
export function useAutoRules(
  rules: AutoRule[],
  onSaveRules: (updated: AutoRule[]) => void
) {
  const [suggestedRuleDraft, setSuggestedRuleDraft] = useState<{
    pattern: string;
    category_id: string;
    split_mode: AutoRule['split_mode'];
  } | null>(null);

  const applyRulesToTransaction = useCallback(
    <T extends Partial<Transaction>>(tx: T) => {
      return RuleEngine.applyRules(tx, rules);
    },
    [rules]
  );

  const checkPassiveLearning = useCallback(
    (tx: Pick<Transaction, 'description' | 'category_id' | 'split_mode'>) => {
      const pattern = RuleEngine.suggestPatternFromDescription(tx.description, rules);
      if (pattern) {
        setSuggestedRuleDraft({
          pattern,
          category_id: tx.category_id,
          split_mode: tx.split_mode,
        });
      }
    },
    [rules]
  );

  const confirmSuggestedRule = useCallback(() => {
    if (!suggestedRuleDraft) return;
    const newRule: AutoRule = {
      id: `rule_${Date.now()}`,
      pattern: suggestedRuleDraft.pattern,
      match_type: 'contains',
      category_id: suggestedRuleDraft.category_id,
      split_mode: suggestedRuleDraft.split_mode,
      priority: rules.length + 1,
      active: true,
    };
    onSaveRules([...rules, newRule]);
    setSuggestedRuleDraft(null);
  }, [suggestedRuleDraft, rules, onSaveRules]);

  const dismissSuggestedRule = useCallback(() => {
    setSuggestedRuleDraft(null);
  }, []);

  return {
    applyRulesToTransaction,
    checkPassiveLearning,
    suggestedRuleDraft,
    confirmSuggestedRule,
    dismissSuggestedRule,
  };
}

/**
 * Hook 2: Client-Side Bank CSV Importer with Duplicate Detection
 */
export function useBankCsvImporter(
  existingTransactions: Transaction[],
  rules: AutoRule[],
  customProfiles: BankImportProfile[] = []
) {
  const availableProfiles = useMemo(
    () => [...DEFAULT_PT_BANK_PROFILES, ...customProfiles],
    [customProfiles]
  );

  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    availableProfiles[0].id
  );
  const [candidates, setCandidates] = useState<ImportedTransactionCandidate[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const parseFile = useCallback(
    async (file: File) => {
      const profile =
        availableProfiles.find((p) => p.id === selectedProfileId) ||
        availableProfiles[0];
      const text = await file.text();
      const parsed = BankImporter.parseCSV(
        text,
        profile,
        existingTransactions,
        rules
      );
      setCandidates(parsed);

      // Auto-select only non-duplicates by default
      const validSet = new Set<number>();
      parsed.forEach((item, idx) => {
        if (item.duplicate_status === 'none') {
          validSet.add(idx);
        }
      });
      setSelectedIndices(validSet);
    },
    [availableProfiles, selectedProfileId, existingTransactions, rules]
  );

  const toggleSelection = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const updateCandidateCategory = useCallback((index: number, categoryId: string) => {
    setCandidates((prev) =>
      prev.map((c, i) =>
        i === index ? { ...c, suggested_category_id: categoryId } : c
      )
    );
  }, []);

  const getConfirmedCandidates = useCallback(() => {
    return candidates.filter((_, idx) => selectedIndices.has(idx));
  }, [candidates, selectedIndices]);

  return {
    availableProfiles,
    selectedProfileId,
    setSelectedProfileId,
    candidates,
    selectedIndices,
    parseFile,
    toggleSelection,
    updateCandidateCategory,
    getConfirmedCandidates,
  };
}

/**
 * Hook 3: Local Receipt OCR Scanner (manages Web Worker lifecycle & cleanup)
 */
export function useReceiptOcr(rules: AutoRule[]) {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<
    'IDLE' | 'LOADING_ENGINE' | 'RECOGNIZING' | 'SUCCESS' | 'ERROR'
  >('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [result, setResult] = useState<ParsedReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scanReceipt = useCallback(
    (imageBlob: Blob | string) => {
      setStatus('LOADING_ENGINE');
      setProgress(0);
      setError(null);

      if (!workerRef.current) {
        workerRef.current = new Worker(
          new URL('../workers/ocrWorker.ts', import.meta.url),
          { type: 'module' }
        );
      }

      workerRef.current.onmessage = (e) => {
        const msg = e.data;
        if (msg.status === 'LOADING_ENGINE') setStatus('LOADING_ENGINE');
        if (msg.status === 'PROGRESS') setProgress(msg.progress);
        if (msg.status === 'RECOGNIZING') setStatus('RECOGNIZING');
        if (msg.status === 'SUCCESS') {
          const parsed = extractReceiptFields(msg.text, rules);
          setResult(parsed);
          setStatus('SUCCESS');
        }
        if (msg.status === 'ERROR') {
          setError(msg.error);
          setStatus('ERROR');
        }
      };

      workerRef.current.postMessage({ type: 'SCAN', imageBlob });
    },
    [rules]
  );

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'TERMINATE' });
      workerRef.current = null;
    }
    setStatus('IDLE');
  }, []);

  useEffect(() => {
    return () => {
      terminateWorker();
    };
  }, [terminateWorker]);

  return { status, progress, result, error, scanReceipt, terminateWorker };
}

/**
 * Hook 4: Isolated "What-If" Financial Sandbox Simulator
 */
export function useWhatIfSimulator(params: {
  startingSavings: number;
  baselineMonthlyIncome: number;
  baselineMonthlyExpenses: number;
}) {
  const [events, setEvents] = useState<SimulationEvent[]>([]);

  const addEvent = useCallback((event: Omit<SimulationEvent, 'id'>) => {
    setEvents((prev) => [...prev, { ...event, id: `sim_${Date.now()}` }]);
  }, []);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const resetSimulation = useCallback(() => {
    setEvents([]);
  }, []);

  const projection = useMemo(
    () =>
      FinancialPlanner.runWhatIfSimulation({
        ...params,
        events,
        monthsHorizon: 12,
      }),
    [params, events]
  );

  return {
    events,
    addEvent,
    removeEvent,
    resetSimulation,
    projection,
  };
}
