import React, { useRef, useState } from 'react';
import { ParsedReceiptData } from '../core/receiptOcr';

interface CategoryOption {
  id: string;
  name: string;
}

interface ReceiptScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: 'IDLE' | 'LOADING_ENGINE' | 'RECOGNIZING' | 'SUCCESS' | 'ERROR';
  progress: number;
  result: ParsedReceiptData | null;
  error: string | null;
  onScanImage: (blob: Blob) => void;
  onTerminateWorker: () => void;
  categories: CategoryOption[];
  onConfirmReceipt: (data: {
    description: string;
    amount: number;
    iso_date: string;
    category_id: string;
  }) => void;
}

export const ReceiptScannerModal: React.FC<ReceiptScannerModalProps> = ({
  isOpen,
  onClose,
  status,
  progress,
  result,
  error,
  onScanImage,
  onTerminateWorker,
  categories,
  onConfirmReceipt,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Editable overrides after OCR extraction
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState('');

  React.useEffect(() => {
    if (result) {
      setMerchant(result.merchant_name || '');
      setAmount(result.amount !== null ? result.amount.toFixed(2) : '');
      setDate(result.iso_date || new Date().toISOString().split('T')[0]);
      setCategoryId(result.suggested_category_id || '');
    }
  }, [result]);

  if (!isOpen) return null;

  const handleClose = () => {
    onTerminateWorker();
    setPreviewUrl(null);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl(URL.createObjectURL(file));
    onScanImage(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!merchant.trim() || isNaN(numAmount) || numAmount <= 0 || !categoryId) return;

    onConfirmReceipt({
      description: merchant.trim(),
      amount: -Math.abs(numAmount), // Expense
      iso_date: date,
      category_id: categoryId,
    });
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between border-b pb-3 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Digitalizar Talão (OCR Local)
            </h2>
            <p className="text-xs text-slate-500">
              Leitura 100% no dispositivo — nenhuma imagem é enviada para servidores.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            ✕
          </button>
        </div>

        {/* Camera / File Trigger */}
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-6 text-center hover:border-emerald-500 hover:bg-emerald-50/40 dark:border-slate-700 dark:bg-slate-800/50"
          >
            <span className="text-2xl">📸</span>
            <span className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-200">
              Tirar Foto ao Talão ou Escolher Imagem
            </span>
          </button>
        </div>

        {previewUrl && (
          <div className="mb-4 flex justify-center">
            <img
              src={previewUrl}
              alt="Pré-visualização do talão"
              className="max-h-36 rounded-lg border border-slate-200 object-contain dark:border-slate-700"
            />
          </div>
        )}

        {/* OCR Progress States */}
        {(status === 'LOADING_ENGINE' || status === 'RECOGNIZING') && (
          <div className="mb-4 rounded-xl bg-indigo-50 p-3 text-center text-xs text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
            <p className="font-medium">
              {status === 'LOADING_ENGINE'
                ? 'A carregar motor OCR em Português...'
                : `A extrair dados do talão... ${progress}%`}
            </p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-indigo-200 dark:bg-indigo-900">
              <div
                className="h-full bg-indigo-600 transition-all duration-200"
                style={{ width: `${status === 'LOADING_ENGINE' ? 25 : progress}%` }}
              />
            </div>
          </div>
        )}

        {status === 'ERROR' && (
          <div className="mb-4 rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            Não foi possível ler o talão: {error}
          </div>
        )}

        {/* Extracted Fields Review Form */}
        {status === 'SUCCESS' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Comerciante / Descrição
              </label>
              <input
                type="text"
                required
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Total (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Data
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Categoria
              </label>
              <select
                required
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              >
                <option value="">Selecionar categoria...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Registar Despesa
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
