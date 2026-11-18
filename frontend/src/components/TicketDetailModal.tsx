import React, { useState, useEffect, useRef } from 'react';
import { CurrentUser, SupportTicket, api, TicketMessage } from '../services/api';
import { 
  X, 
  Send, 
  Building2, 
  User, 
  Mail, 
  Phone, 
  ShieldCheck, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  AlertTriangle,
  Compass,
  MessageSquare,
  Lock,
  ArrowRight,
  Sparkles
} from 'lucide-react';

interface TicketDetailModalProps {
  ticket: SupportTicket;
  currentUser: CurrentUser;
  onClose: () => void;
  onTicketUpdated: (updatedTicket: SupportTicket) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  OPEN: { label: 'Open', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  WAITING_FOR_CLIENT: { label: 'Waiting for Client', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  RESOLVED: { label: 'Resolved', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  CLOSED: { label: 'Closed', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-300' },
};

const PRIORITY_BADGES: Record<string, { label: string; class: string }> = {
  LOW: { label: 'LOW', class: 'bg-slate-100 text-slate-700 border-slate-200' },
  MEDIUM: { label: 'MEDIUM', class: 'bg-blue-100 text-blue-700 border-blue-200' },
  HIGH: { label: 'HIGH', class: 'bg-amber-100 text-amber-800 border-amber-300' },
  URGENT: { label: 'URGENT', class: 'bg-red-100 text-red-700 border-red-300 animate-pulse' },
};

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket: initialTicket,
  currentUser,
  onClose,
  onTicketUpdated,
}) => {
  const [ticket, setTicket] = useState<SupportTicket>(initialTicket);
  const [replyMessage, setReplyMessage] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
  const [newStatus, setNewStatus] = useState<string>(initialTicket.status);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [showResolvePrompt, setShowResolvePrompt] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isSuperAdmin = currentUser.role === 'super_admin';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [ticket.messages]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || isSending) return;

    try {
      setIsSending(true);
      setErrorMsg('');

      const res = await api.replySupportTicket(ticket._id, {
        sender_id: currentUser.id,
        sender_name: currentUser.full_name || (isSuperAdmin ? 'Antigravity Support' : 'Company Admin'),
        sender_role: isSuperAdmin ? 'super_admin' : 'client',
        message: replyMessage.trim()
      });

      if (res && res._id) {
        setTicket(res);
        setReplyMessage('');
        onTicketUpdated(res);
      } else {
        setErrorMsg(res?.detail || 'Failed to deliver reply.');
      }
    } catch (err: any) {
      console.error('Error replying to ticket:', err);
      setErrorMsg(err.message || 'Network error while posting message.');
    } finally {
      setIsSending(false);
    }
  };

  const handleStatusChange = async (targetStatus: string, notes?: string) => {
    try {
      setIsUpdatingStatus(true);
      setErrorMsg('');

      const res = await api.updateSupportTicketStatus(
        ticket._id,
        targetStatus,
        currentUser.full_name,
        notes || resolutionNotes
      );

      if (res && res._id) {
        setTicket(res);
        setNewStatus(res.status);
        setShowResolvePrompt(false);
        onTicketUpdated(res);
      } else {
        setErrorMsg(res?.detail || 'Failed to update status.');
      }
    } catch (err: any) {
      console.error('Error updating status:', err);
      setErrorMsg(err.message || 'Network error while updating ticket status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const statusInfo = STATUS_CONFIG[ticket.status] || {
    label: ticket.status,
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200'
  };

  const priorityBadge = PRIORITY_BADGES[ticket.priority] || {
    label: ticket.priority,
    class: 'bg-slate-100 text-slate-700 border-slate-200'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Top Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 flex items-center justify-center text-white font-mono font-black text-sm shadow-lg shadow-indigo-500/30 shrink-0">
              TCK
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-black tracking-wider text-indigo-300 bg-indigo-950 px-2 py-0.5 rounded-md border border-indigo-800">
                  {ticket.ticket_number}
                </span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                  {statusInfo.label}
                </span>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${priorityBadge.class}`}>
                  {priorityBadge.label}
                </span>
              </div>
              <h3 className="text-base font-extrabold text-white tracking-tight truncate mt-1">
                {ticket.subject}
              </h3>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Company & Context Meta Strip */}
        <div className="bg-gradient-to-r from-slate-50 via-indigo-50/40 to-slate-50 px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Tagged Company Indicator */}
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-indigo-600 text-white rounded-lg">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider block">Tagged Company</span>
              <span className="font-black text-slate-900 text-xs">{ticket.company_name}</span>
            </div>
          </div>

          {/* Requester User Info */}
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-slate-200 text-slate-700 rounded-lg">
              <User className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Raised By</span>
              <span className="font-bold text-slate-800 text-xs">
                {ticket.user_name} <span className="text-[10px] font-normal text-slate-500">({ticket.user_role})</span>
              </span>
            </div>
          </div>

          {/* Context Screen & Category */}
          <div className="flex items-center gap-3">
            <div className="bg-white px-2.5 py-1 rounded-xl border border-slate-200 text-[11px] text-slate-600">
              Category: <strong className="text-slate-900 uppercase font-bold">{ticket.category}</strong>
            </div>
            {ticket.context_page && (
              <div className="bg-white px-2.5 py-1 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-center gap-1">
                <Compass className="h-3 w-3 text-indigo-500" />
                <span>Page: <strong className="text-slate-800">{ticket.context_page}</strong></span>
              </div>
            )}
          </div>
        </div>

        {/* Action Bar (Status Control) */}
        <div className="bg-white px-6 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-slate-500 font-semibold">Change Lifecycle Status:</span>
            {isSuperAdmin ? (
              <select
                value={ticket.status}
                disabled={isUpdatingStatus}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'RESOLVED') {
                    setShowResolvePrompt(true);
                  } else {
                    handleStatusChange(val);
                  }
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold text-xs bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="OPEN">Open (Waiting Support)</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="WAITING_FOR_CLIENT">Waiting for Client</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
            ) : (
              // Client view status pills
              <div className="flex items-center space-x-2">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                  {statusInfo.label}
                </span>
                {ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED' && (
                  <button
                    type="button"
                    onClick={() => handleStatusChange('RESOLVED', 'Resolved directly by client.')}
                    disabled={isUpdatingStatus}
                    className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 text-xs font-bold transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Issue Fixed? Mark Resolved</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>Logged: {new Date(ticket.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        {/* Resolution Prompt Modal / Box (if Super Admin selecting RESOLVED) */}
        {showResolvePrompt && (
          <div className="p-4 bg-purple-50 border-b border-purple-200 animate-in fade-in duration-150">
            <div className="max-w-xl mx-auto space-y-2">
              <div className="flex items-center justify-between">
                <h5 className="text-xs font-black text-purple-900 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-purple-600" />
                  Mark Ticket as Resolved
                </h5>
                <button
                  type="button"
                  onClick={() => setShowResolvePrompt(false)}
                  className="text-purple-400 hover:text-purple-700 text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={2}
                placeholder="Optional resolution summary or action taken (e.g. IndiaMART webhook token updated and sync verified)..."
                className="w-full px-3 py-1.5 rounded-xl border border-purple-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleStatusChange('RESOLVED', resolutionNotes)}
                  disabled={isUpdatingStatus}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold shadow-sm"
                >
                  Confirm Resolved
                </button>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700 font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Conversation Thread Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50 kanban-col">
          {ticket.messages && ticket.messages.length > 0 ? (
            ticket.messages.map((msg: TicketMessage, idx: number) => {
              const isSupport = msg.sender_role === 'super_admin' || msg.sender_role === 'support';
              const isMe = msg.sender_id === currentUser.id;

              return (
                <div
                  key={msg.message_id || idx}
                  className={`flex flex-col ${isSupport ? 'items-end' : 'items-start'}`}
                >
                  {/* Sender Label */}
                  <div className="flex items-center space-x-1.5 mb-1 px-1 text-[11px] text-slate-500 font-medium">
                    {isSupport ? (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />
                        <span className="font-black text-indigo-950">Central Support Team</span>
                        <span>•</span>
                        <span>{new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </>
                    ) : (
                      <>
                        <Building2 className="h-3.5 w-3.5 text-slate-600" />
                        <span className="font-bold text-slate-800">{msg.sender_name}</span>
                        <span className="text-[10px] text-slate-400">({ticket.company_name})</span>
                        <span>•</span>
                        <span>{new Date(msg.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </>
                    )}
                  </div>

                  {/* Message Bubble */}
                  <div
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 shadow-sm text-xs leading-relaxed whitespace-pre-wrap ${
                      isSupport
                        ? 'bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-tr-none shadow-indigo-900/10'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                    }`}
                  >
                    {msg.message}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 text-slate-400">
              <MessageSquare className="h-10 w-10 mx-auto text-slate-300 mb-2" />
              <p className="text-xs">No replies in conversation yet.</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Resolved / Closed Banner or Reply Box */}
        {ticket.status === 'CLOSED' ? (
          <div className="p-4 bg-slate-100 border-t border-slate-200 text-center text-xs text-slate-500 font-medium flex items-center justify-center gap-2">
            <Lock className="h-4 w-4 text-slate-400" />
            <span>This ticket is closed. To report any further issues, please create a new support ticket.</span>
          </div>
        ) : (
          <form onSubmit={handleSendReply} className="p-4 bg-white border-t border-slate-200 shrink-0">
            <div className="flex items-center space-x-3">
              <textarea
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                placeholder={
                  isSuperAdmin
                    ? 'Reply as Central Support to client...'
                    : 'Add reply or additional details for the support team...'
                }
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendReply(e);
                  }
                }}
                className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-300 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
              <button
                type="submit"
                disabled={!replyMessage.trim() || isSending}
                className="h-11 px-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs flex items-center space-x-2 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-40"
              >
                {isSending ? (
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Reply</span>
                    <Send className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 px-1 flex items-center justify-between">
              <span>Press <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded text-[9px] font-mono">Enter</kbd> to send, <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded text-[9px] font-mono">Shift+Enter</kbd> for new line</span>
              {ticket.resolution_notes && (
                <span className="text-purple-600 font-semibold truncate max-w-sm">
                  Resolution: {ticket.resolution_notes}
                </span>
              )}
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
