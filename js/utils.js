// js/utils.js — Utilitários partilhados (DOM, formatação, datas e cálculos)
export const $ = id => document.getElementById(id);
export const now = () => new Date();
export const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const cur = () => iso(now()).slice(0, 7);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const eur = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
export const sum = a => a.reduce((s, t) => s + (Number(t.amount) || 0), 0);

export const isPaid = t => !t.status || t.status === 'paid';
export const isSavingTx = t => t.type === 'saving' || t.type === 'saving_withdraw';
export const savingSigned = t => t.type === 'saving' ? (Number(t.amount) || 0) : t.type === 'saving_withdraw' ? -(Number(t.amount) || 0) : 0;

export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const capFirst = s => s ? s[0].toUpperCase() + s.slice(1) : '';
export const mName = m => new Date(m + '-01T12:00:00').toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
export const fmtDate = s => validDate(s) ? new Date(s + 'T12:00:00').toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return iso(d);
}

export function daysBetween(a, b) {
  const d1 = new Date(a + 'T12:00:00');
  const d2 = new Date(b + 'T12:00:00');
  return Math.round((d2 - d1) / 86400000);
}

export function monthLast(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

export const monthIndex = ym => {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
};

export function dueDate(y, m, day) {
  const maxD = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(Math.max(1, day), maxD)).padStart(2, '0')}`;
}
