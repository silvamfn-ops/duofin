import React from 'react';
import {
  ImportedTransactionCandidate,
  BankImportProfile,
} from '../core/types';

interface CategoryOption {
  id: string;
  name: string;
}

interface BankCsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: BankImportProfile[];
  selectedProfileId: string;
  onSelectProfile: (id: string) => void;
  onFileUpload: (file: File) => void;
  candidates: ImportedTransactionCandidate[];
  selectedIndices: Set<number>;
  onToggleIndex: (idx: number) => void;
  onChangeCategory: (idx: number, categoryId: string) => void;
  categories: CategoryOption[];
  onConfirmImport: () => void;
}

export const BankCsvImportModal: React.FC<BankCsvImportModalProps> = ({
  isOpen,
  onClose,
  profiles,
  selectedProfileId,
  onSelectProfile,
  onFileUpload,
  candidates,
  selectedIndices,
  onToggleIndex,
  onChangeCategory,
  categories,
  onConfirmImport,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between border-b pb-3 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Importar Extrato Bancário (100% Local)
            </h2>
            <p className="text-xs text-slate-500">
              Os dados são processados no dispositivo e encriptados antes de sincronizar.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2.5 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Step 1: Bank Profile & File Picker */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Banco / Formato CSV
            </label>
            <select
              value={selectedProfileId}
              onChange={(e) => onSelectProfile(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.bank_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Ficheiro CSV
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileUpload(file);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-emerald-700 dark:border-slate-700"
            />
          </div>
        </div>

        {/* Step 2: Candidate Review Table */}
        {candidates.length > 0 && (
          <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="p-2.5">Importar</th>
                  <th className="p-2.5">Data</th>
                  <th className="p-2.5">Descrição</th>
                  <th className="p-2.5">Categoria (Auto)</th>
                  <th className="p-2.5 text-right">Valor</th>
                  <th className="p-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {candidates.map((item, idx) => {
                  const isChecked = selectedIndices.has(idx);
                  return (
                    <tr
                      key={idx}
                      className={
                        item.duplicate_status === 'exact'
                          ? 'bg-rose-50/50 dark:bg-rose-950/20'
                          : item.duplicate_status === 'probable'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20'
                          : ''
                      }
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggleIndex(idx)}
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        />
                      </td>
                      <td className="whitespace-nowrap p-2.5 font-mono">{item.iso_date}</td>
                      <td className="p-2.5 font-medium">{item.description}</td>
                      <td className="p-2.5">
                        <select
                          value={item.suggested_category_id || ''}
                          onChange={(e) => onChangeCategory(idx, e.target.value)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                        >
                          <option value="">Selecionar...</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td
                        className={`whitespace-nowrap p-2.5 text-right font-semibold ${
                          item.amount < 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}
                      >
                        {item.amount.toFixed(2)} €
                      </td>
                      <td className="whitespace-nowrap p-2.5">
                        {item.duplicate_status === 'exact' && (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                            Duplicado Exato
                          </span>
                        )}
                        {item.duplicate_status === 'probable' && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Possível Duplicado (±3d)
                          </span>
                        )}
                        {item.duplicate_status === 'none' && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                            Novo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-5 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {selectedIndices.size} de {candidates.length} transações selecionadas
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
            >
              Cancelar
            </button>
            <button
              disabled={selectedIndices.size === 0}
              onClick={onConfirmImport}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Confirmar Importação ({selectedIndices.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
