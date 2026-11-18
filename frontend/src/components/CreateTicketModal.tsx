import React, { useState, useRef } from 'react';
import { CurrentUser, TenantInfo, api, SupportTicket } from '../services/api';
import { 
  X, 
  LifeBuoy, 
  Send, 
  Building2, 
  User, 
  Mail, 
  Phone, 
  AlertTriangle, 
  Sparkles, 
  CheckCircle2, 
  Compass,
  FileQuestion,
  Receipt,
  MessageSquare,
  Users,
  ShieldAlert,
  Bug,
  Paperclip,
  Image as ImageIcon,
  ZoomIn,
  Trash2,
  UploadCloud
} from 'lucide-react';
import { compressImage } from '../utils/imageHelper';
import { ImageLightboxModal } from './ImageLightboxModal';

interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: CurrentUser;
  tenantInfo: TenantInfo | null;
  defaultContextPage?: string;
  onTicketCreated: (newTicket: SupportTicket) => void;
}

const CATEGORIES = [
  { id: 'webhooks', label: 'Webhooks & Ingestion', icon: Compass, desc: 'IndiaMART, Facebook, TradeIndia & Website Webhooks' },
  { id: 'billing', label: 'Billing & Invoices', icon: Receipt, desc: 'GST Quotations, Invoices, Payments & Financials' },
  { id: 'whatsapp_sms', label: 'WhatsApp & SMS', icon: MessageSquare, desc: 'Cloud API, Follow-up alerts & Message templates' },
  { id: 'leads', label: 'Leads & Pipeline', icon: Users, desc: 'Lead Assignment, Kanban stages, CSV import' },
  { id: 'team_access', label: 'Team & Permissions', icon: ShieldAlert, desc: 'Staff roles, login credentials & user accounts' },
  { id: 'general_bug', label: 'UI Bug / Technical Issue', icon: Bug, desc: 'Something not working, unexpected errors' },
];

const PRIORITIES = [
  { id: 'LOW', label: 'Low', color: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200' },
  { id: 'MEDIUM', label: 'Medium', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
  { id: 'HIGH', label: 'High', color: 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' },
  { id: 'URGENT', label: 'Urgent (Critical)', color: 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100' },
];

export const CreateTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  tenantInfo,
  defaultContextPage = 'CRM Workspace',
  onTicketCreated
}) => {
  const [category, setCategory] = useState<string>('webhooks');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [subject, setSubject] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [createdTicket, setCreatedTicket] = useState<SupportTicket | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const companyName = tenantInfo?.company_name || (currentUser.role === 'super_admin' ? 'Super Admin System' : 'Your Registered Organization');
  const tenantId = tenantInfo?.id || currentUser.tenant_id || 'demo_tenant_01';

  const handleFilesSelected = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    setIsCompressing(true);
    setErrorMsg('');
    try {
      const newAttachments: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const compressed = await compressImage(file);
          newAttachments.push(compressed);
        }
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (err) {
      console.error('Failed to process image:', err);
      setErrorMsg('Failed to process screenshot attachment.');
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      await handleFilesSelected(imageFiles);
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!subject.trim()) {
      setErrorMsg('Please enter a clear subject for your ticket.');
      return;
    }
    if (!description.trim()) {
      setErrorMsg('Please describe the issue or requirement in detail.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await api.createSupportTicket({
        tenant_id: tenantId,
        user_id: currentUser.id,
        user_name: currentUser.full_name || 'CRM User',
        user_email: currentUser.email,
        user_phone: currentUser.phone,
        user_role: currentUser.role,
        category,
        priority,
        subject: subject.trim(),
        description: description.trim(),
        context_page: defaultContextPage,
        attachments
      });

      const actualTicket = res?.ticket || (res?._id ? res : null);
      if (actualTicket && (actualTicket._id || actualTicket.ticket_number)) {
        setCreatedTicket(actualTicket);
        onTicketCreated(actualTicket);
      } else {
        setErrorMsg(res?.detail || 'Failed to create ticket. Please check connection and try again.');
      }
    } catch (err: any) {
      console.error('Error creating ticket:', err);
      setErrorMsg(err.message || 'Error communicating with server.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAndClose = () => {
    setSubject('');
    setDescription('');
    setAttachments([]);
    setCategory('webhooks');
    setPriority('MEDIUM');
    setCreatedTicket(null);
    setErrorMsg('');
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto"
      onPaste={handlePaste}
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white flex items-center justify-between border-b border-indigo-900/50 shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="h-12 w-12 rounded-2xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center border border-indigo-400/30 shadow-inner">
              <LifeBuoy className="h-6 w-6 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black tracking-tight text-white">Create Support Ticket</h3>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/40">
                  Priority Helpdesk
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Direct channel to technical support. Your company & account details are tagged automatically.
              </p>
            </div>
          </div>
          <button
            onClick={handleResetAndClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        {createdTicket ? (
          <div className="p-8 text-center space-y-5 overflow-y-auto kanban-col">
            <div className="h-16 w-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="h-9 w-9" />
            </div>
            <div className="space-y-2">
              <h4 className="text-xl font-black text-slate-900">Support Ticket Generated!</h4>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Your ticket has been logged with reference <span className="font-black text-indigo-600 font-mono">{createdTicket.ticket_number}</span> and assigned to central support.
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left max-w-md mx-auto text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Tagged Company:</span>
                <span className="font-bold text-slate-900">{createdTicket.company_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Subject:</span>
                <span className="font-bold text-slate-900 truncate max-w-[240px]">{createdTicket.subject}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Screenshots Attached:</span>
                <span className="font-bold text-indigo-600">{(createdTicket.attachments || []).length} Image(s)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Priority:</span>
                <span className="font-bold text-red-600 uppercase">{createdTicket.priority}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Status:</span>
                <span className="font-bold text-blue-600 uppercase">{createdTicket.status}</span>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all"
              >
                Done & View Ticket List
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto kanban-col flex-1">
            
            {/* Automatic Company Tag Chip Preview */}
            <div className="p-3.5 bg-gradient-to-r from-indigo-50/80 via-blue-50/80 to-slate-50 rounded-2xl border border-indigo-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-600 text-white rounded-lg">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider block">Auto-Tagged Company</span>
                  <span className="font-bold text-slate-900 text-xs">{companyName}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-600 text-white rounded-lg">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-blue-700 tracking-wider block">Logged In Requester</span>
                  <span className="font-bold text-slate-900 text-xs">{currentUser.full_name} ({currentUser.role.replace('_', ' ').toUpperCase()})</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium bg-white/80 px-2.5 py-1 rounded-xl border border-slate-200">
                <Sparkles className="h-3 w-3 text-indigo-500" />
                <span>Screen: <strong className="text-slate-700">{defaultContextPage}</strong></span>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Category Grid */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Select Issue Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.id;
                  return (
                    <button
                      type="button"
                      key={cat.id}
                      onClick={() => setCategory(cat.id)}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/60 ring-2 ring-indigo-500/20 shadow-sm'
                          : 'border-slate-200 bg-slate-50/50 hover:bg-slate-100/70 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <Icon className={`h-4 w-4 ${isSelected ? 'text-indigo-600' : 'text-slate-500'}`} />
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                          {cat.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">
                        {cat.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priority Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                Priority Level
              </label>
              <div className="flex flex-wrap gap-2">
                {PRIORITIES.map((p) => {
                  const isSelected = priority === p.id;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setPriority(p.id)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${p.color} ${
                        isSelected ? 'ring-2 ring-indigo-500 ring-offset-1 font-extrabold shadow-sm' : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Ticket Title / Subject <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary (e.g. IndiaMART webhook leads not syncing, GST invoice total mismatch)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            {/* Detailed Description */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Describe the Issue or Support Request <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Provide complete details: What happened? What were you trying to do? Any error messages observed?"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 kanban-col"
                required
              />
            </div>

            {/* SCREENSHOT ATTACHMENTS SECTION */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Attach Screenshots / Proof (Optional)
                </label>
                <span className="text-[11px] text-indigo-600 font-medium">
                  Tip: Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono text-[10px]">Ctrl+V</kbd> to paste screenshot
                </span>
              </div>

              {/* Upload Drop Zone / Button */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files);
                }}
                className="border-2 border-dashed border-indigo-200 hover:border-indigo-500 bg-indigo-50/30 hover:bg-indigo-50/60 rounded-2xl p-4 text-center cursor-pointer transition-all group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files) handleFilesSelected(e.target.files);
                  }}
                  className="hidden"
                />

                <div className="flex items-center justify-center space-x-2 text-indigo-600 group-hover:scale-105 transition-transform">
                  <UploadCloud className="h-5 w-5" />
                  <span className="text-xs font-bold">Click to Browse or Drag & Drop Screenshots</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Supports PNG, JPG, WebP screenshots or paste directly from clipboard
                </p>
              </div>

              {isCompressing && (
                <div className="flex items-center gap-2 p-2 bg-indigo-50 rounded-xl text-xs text-indigo-700 font-semibold animate-pulse">
                  <div className="h-3.5 w-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  <span>Processing and optimizing screenshot...</span>
                </div>
              )}

              {/* Attached Thumbnails Grid */}
              {attachments.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 pt-1">
                  {attachments.map((img, idx) => (
                    <div 
                      key={idx} 
                      className="relative group rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-video shadow-sm"
                    >
                      <img
                        src={img}
                        alt={`Attachment ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      
                      {/* Hover action overlay */}
                      <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(img)}
                          className="p-1.5 rounded-lg bg-white/20 hover:bg-white text-white hover:text-slate-900 transition-colors"
                          title="View Full Size"
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(idx)}
                          className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                          title="Remove Screenshot"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white font-bold">
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="pt-3 flex items-center justify-end space-x-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isCompressing}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Submitting Ticket...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Submit Support Ticket</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Lightbox Zoom Modal */}
      {previewImage && (
        <ImageLightboxModal
          imageUrl={previewImage}
          onClose={() => setPreviewImage(null)}
          title="Attached Screenshot"
        />
      )}
    </div>
  );
};
