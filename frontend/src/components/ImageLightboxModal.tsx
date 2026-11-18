import React from 'react';
import { X, Download, ZoomIn } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  onClose: () => void;
  title?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  onClose,
  title = 'Screenshot Preview'
}) => {
  if (!imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `screenshot_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="relative max-w-5xl max-h-[92vh] w-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Control Bar */}
        <div className="w-full flex items-center justify-between text-white pb-3 px-2">
          <div className="flex items-center space-x-2">
            <ZoomIn className="h-4 w-4 text-indigo-400" />
            <span className="text-xs font-bold text-slate-200">{title}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownload}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors"
              title="Download image"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Image Display */}
        <div className="w-full flex items-center justify-center overflow-auto rounded-2xl bg-black/40 border border-white/10 shadow-2xl p-2 max-h-[82vh]">
          <img
            src={imageUrl}
            alt="Screenshot"
            className="max-h-[80vh] max-w-full object-contain rounded-xl shadow-lg"
          />
        </div>
      </div>
    </div>
  );
};
