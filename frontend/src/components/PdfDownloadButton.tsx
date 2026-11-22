import React, { useState } from 'react';
import { api } from '../services/api';
import { Download, Loader2 } from 'lucide-react';

interface PdfDownloadButtonProps {
  invoiceId: string;
  invoiceNumber?: string;
  label?: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Downloads a bill as PDF with the signed-in user's session.
 * A plain link cannot be used: the PDF endpoint requires the access token, which is never put in a URL.
 */
export const PdfDownloadButton: React.FC<PdfDownloadButtonProps> = ({
  invoiceId,
  invoiceNumber,
  label = 'PDF',
  className = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer',
  iconClassName = 'h-3 w-3',
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await api.downloadInvoicePdf(invoiceId, invoiceNumber);
    setBusy(false);
    if (!result.ok) {
      setError(result.message || 'The PDF could not be downloaded.');
      window.setTimeout(() => setError(''), 6000);
    }
  };

  return (
    <span className="relative inline-flex">
      <button type="button" onClick={handleClick} disabled={busy} className={`${className} disabled:opacity-60`} title="Download PDF">
        {busy ? <Loader2 className={`${iconClassName} animate-spin`} /> : <Download className={iconClassName} />}
        <span>{busy ? 'Preparing…' : label}</span>
      </button>
      {error && (
        <span role="alert" className="absolute z-20 top-full right-0 mt-1 w-56 p-2 rounded-lg bg-rose-600 text-white text-[10px] font-bold shadow-lg text-left">
          {error}
        </span>
      )}
    </span>
  );
};
