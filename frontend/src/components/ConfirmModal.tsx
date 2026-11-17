import React from 'react';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const iconAndColor = () => {
    switch (variant) {
      case 'danger':
        return {
          icon: <AlertCircle className="h-6 w-6 text-rose-600" />,
          btnBg: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20',
          iconBg: 'bg-rose-100',
        };
      case 'primary':
        return {
          icon: <Info className="h-6 w-6 text-blue-600" />,
          btnBg: 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20',
          iconBg: 'bg-blue-100',
        };
      default:
        return {
          icon: <AlertTriangle className="h-6 w-6 text-amber-600" />,
          btnBg: 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-500/20',
          iconBg: 'bg-amber-100',
        };
    }
  };

  const { icon, btnBg, iconBg } = iconAndColor();

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start gap-3.5">
          <div className={`h-11 w-11 rounded-2xl ${iconBg} flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-slate-900 text-base">{title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{message}</p>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pt-2 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50 ${btnBg}`}
          >
            {isLoading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
