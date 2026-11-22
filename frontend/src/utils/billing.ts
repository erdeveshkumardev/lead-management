import { Invoice, PaymentStatus } from '../services/api';

/** Rupee amount in Indian digit grouping, always with two decimals. */
export const money = (value: number | string | null | undefined): string =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const documentLabel = (documentType: string): string => {
  if (documentType === 'TAX_INVOICE') return 'GST Tax Invoice';
  if (documentType === 'PROFORMA') return 'Proforma Invoice';
  return 'Quotation';
};

export const documentShortLabel = (documentType: string): string => {
  if (documentType === 'TAX_INVOICE') return 'GST Invoice';
  if (documentType === 'PROFORMA') return 'Proforma';
  return 'Quotation';
};

export interface StatusMeta {
  label: string;
  className: string;
}

/** Label and colours for every payment status the server can return. */
export const paymentStatusMeta = (status: PaymentStatus | string): StatusMeta => {
  switch (status) {
    case 'PAID':
      return { label: 'Fully Paid', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'PARTIALLY_PAID':
      return { label: 'Partially Paid', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'OVERDUE':
      return { label: 'Overdue', className: 'bg-rose-100 text-rose-800 border-rose-300' };
    case 'CANCELLED':
      return { label: 'Cancelled', className: 'bg-slate-100 text-slate-500 border-slate-300 line-through' };
    case 'NOT_APPLICABLE':
      return { label: 'Not a bill', className: 'bg-slate-50 text-slate-500 border-slate-200' };
    default:
      return { label: 'Unpaid', className: 'bg-red-50 text-red-700 border-red-200' };
  }
};

/** Payments are only taken against live tax invoices (never quotations, proformas or cancelled documents). */
export const canTakePayment = (invoice: Invoice): boolean =>
  invoice.document_type === 'TAX_INVOICE' && invoice.payment_status !== 'CANCELLED' && Number(invoice.financials?.balance_due || 0) > 0;

export const PAYMENT_MODES: Array<{ value: string; label: string; needsReference: boolean }> = [
  { value: 'UPI', label: 'UPI (Google Pay / PhonePe / Paytm)', needsReference: true },
  { value: 'NEFT', label: 'NEFT', needsReference: true },
  { value: 'RTGS', label: 'RTGS', needsReference: true },
  { value: 'IMPS', label: 'IMPS', needsReference: true },
  { value: 'CHEQUE', label: 'Cheque', needsReference: true },
  { value: 'CARD', label: 'Credit / Debit Card', needsReference: true },
  { value: 'CASH', label: 'Cash (below ₹2,00,000 only)', needsReference: false },
];

/** Income-tax Act s.269ST: a single cash receipt must stay below this amount. The server enforces it. */
export const CASH_LIMIT = 200000;

/** Today's date as YYYY-MM-DD in the user's own time zone (for date inputs). */
export const todayIso = (): string => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
