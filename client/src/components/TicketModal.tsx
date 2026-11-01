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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl text-slate-100">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <LifeBuoy className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Raise TeleNova Support Ticket</h3>
            <p className="text-xs text-slate-400">Escalate directly to our specialized support team</p>
          </div>
        </div>

        {createdTicket ? (
          <div className="bg-emerald-950/40 border border-emerald-500/30 rounded-xl p-4 my-4 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-2">
              <Check className="w-6 h-6" />
            </div>
            <div className="font-bold text-lg text-emerald-300">Ticket Generated</div>
            <div className="text-2xl font-mono font-extrabold text-white my-1">{createdTicket.ticketNumber}</div>
            <p className="text-xs text-emerald-200/80">
              Our human support team will review this query. Expected turnaround time is 4 hours.
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm rounded-xl transition"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Customer Query</label>
              <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-3 text-sm text-slate-200">
                {userQuery || 'No specific inquiry text captured.'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Additional Notes (Optional)</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Provide phone number or any relevant billing details..."
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-xl hover:bg-slate-700/50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-600/30 transition"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm & Create Ticket
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
