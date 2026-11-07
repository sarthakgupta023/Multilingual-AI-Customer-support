import React, { useState } from 'react';
import { LifeBuoy, X, Check, Loader2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userQuery: string;
  customerLanguage: string;
  onTicketCreated: (ticket: any) => void;
}

export const TicketModal: React.FC<Props> = ({
  isOpen,
  onClose,
  userQuery,
  customerLanguage,
  onTicketCreated,
}) => {
  const [summary, setSummary] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdTicket, setCreatedTicket] = useState<any | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: customerLanguage,
          query: userQuery,
          summary: summary || 'User inquiry not present in policy repository.',
        }),
      });

      if (res.ok) {
        const ticket = await res.json();
        setCreatedTicket(ticket);
        onTicketCreated(ticket);
      }
    } catch (err) {
      console.error('Failed to create ticket:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-xl text-slate-900">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-base text-slate-900">Escalate to Human Support</h3>
            <p className="text-xs text-slate-500">TeleNova Customer Service Helpdesk</p>
          </div>
        </div>

        {createdTicket ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 my-3 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-2">
              <Check className="w-5 h-5" />
            </div>
            <div className="font-bold text-sm text-emerald-900 uppercase tracking-wide">Support Ticket Generated</div>
            <div className="text-2xl font-mono font-extrabold text-slate-900 my-1">{createdTicket.ticketNumber}</div>
            <p className="text-xs text-slate-600 mt-2">
              This request is now logged into the <strong>Human Support Admin Desk</strong>. A customer service representative will follow up within 4 hours.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-lg transition"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Customer Inquiry</label>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-800 leading-relaxed">
                {userQuery || 'No inquiry text specified.'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Additional Context / Phone Number</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Include registered 10-digit mobile number or specific request details..."
                rows={3}
                className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Submit to Human Agent Desk
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
