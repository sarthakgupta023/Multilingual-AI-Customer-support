import React, { useState, useEffect } from 'react';
import {
  LifeBuoy,
  Search,
  RefreshCw,
  Trash2,
  Save,
  Activity,
  ArrowLeft,
  Calendar,
} from 'lucide-react';

export interface AdminTicket {
  id: string;
  ticketNumber: string;
  customerLanguage: string;
  userQuery: string;
  conversationSummary?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
  assignedAgent?: string;
  agentNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface Props {
  onBackToCustomerDesk: () => void;
}

export const AdminSupportDesk: React.FC<Props> = ({ onBackToCustomerDesk }) => {
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'tickets' | 'telemetry'>('tickets');
  const [turnLogs, setTurnLogs] = useState<any[]>([]);
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);

  const fetchTickets = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/tickets');
      if (res.ok) {
        const data = await res.json();
        setTickets(data);
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTurnLogs = async () => {
    try {
      const res = await fetch('/api/admin/turns');
      if (res.ok) {
        const data = await res.json();
        setTurnLogs(data);
      }
    } catch (err) {
      console.error('Failed to load turn logs:', err);
    }
  };

  useEffect(() => {
    fetchTickets();
    fetchTurnLogs();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleSaveNotes = async (id: string) => {
    const notes = editingNotes[id];
    if (notes === undefined) return;
    setSavingTicketId(id);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentNotes: notes }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
      }
    } catch (err) {
      console.error('Failed to save notes:', err);
    } finally {
      setSavingTicketId(null);
    }
  };

  const handleDeleteTicket = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this ticket record?')) return;
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTickets((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  };

  const filteredTickets = tickets.filter((t) => {
    const matchesStatus = filterStatus === 'ALL' || t.status === filterStatus;
    const matchesSearch =
      t.ticketNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.userQuery.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.conversationSummary || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const openCount = tickets.filter((t) => t.status === 'OPEN').length;
  const inProgressCount = tickets.filter((t) => t.status === 'IN_PROGRESS').length;
  const resolvedCount = tickets.filter((t) => t.status === 'RESOLVED').length;

  return (
    <div className="flex flex-col h-full bg-[#f8fafc] text-slate-900 font-sans">
      {/* Top Admin Sub-Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToCustomerDesk}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Customer Voice Desk</span>
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">Human Support Desk</h2>
            <p className="text-xs text-slate-500">TeleNova Operations & Escalation Queue</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setActiveTab('tickets')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'tickets' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Support Tickets ({tickets.length})
            </button>
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`px-3 py-1 rounded-md transition ${
                activeTab === 'telemetry' ? 'bg-white text-slate-900 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Turn Telemetry ({turnLogs.length})
            </button>
          </div>

          <button
            onClick={() => {
              fetchTickets();
              fetchTurnLogs();
            }}
            disabled={isLoading}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg border border-slate-200 hover:bg-slate-50 transition"
            title="Refresh records"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {activeTab === 'tickets' ? (
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Metrics summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase text-slate-500">Total Escalations</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{tickets.length}</div>
            </div>
            <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase text-amber-700">Awaiting Agent (Open)</div>
              <div className="text-2xl font-bold text-amber-800 mt-1">{openCount}</div>
            </div>
            <div className="bg-white border border-blue-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase text-blue-700">In Progress</div>
              <div className="text-2xl font-bold text-blue-800 mt-1">{inProgressCount}</div>
            </div>
            <div className="bg-white border border-emerald-200 rounded-xl p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase text-emerald-700">Resolved</div>
              <div className="text-2xl font-bold text-emerald-800 mt-1">{resolvedCount}</div>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ticket number, customer inquiry..."
                className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-800 transition"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto w-full sm:w-auto">
              {['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED'].map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                    filterStatus === status
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {status === 'ALL' ? 'All Statuses' : status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Ticket Cards List */}
          {filteredTickets.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-500">
              <LifeBuoy className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium">No tickets match the selected filters.</p>
              <p className="text-xs text-slate-400 mt-1">Escalated inquiries from voice sessions appear here automatically.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTickets.map((t) => {
                const isSaving = savingTicketId === t.id;
                const notesValue = editingNotes[t.id] !== undefined ? editingNotes[t.id] : (t.agentNotes || '');

                return (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-bold text-sm text-slate-900">{t.ticketNumber}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-100 text-slate-700 border border-slate-200">
                          Lang: {t.customerLanguage}
                        </span>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Calendar className="w-3 h-3" />
                          <span>{new Date(t.createdAt).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Status selector */}
                        <select
                          value={t.status}
                          onChange={(e) => handleUpdateStatus(t.id, e.target.value)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-md border outline-none cursor-pointer transition ${
                            t.status === 'OPEN'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : t.status === 'IN_PROGRESS'
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          <option value="OPEN">Status: OPEN</option>
                          <option value="IN_PROGRESS">Status: IN PROGRESS</option>
                          <option value="RESOLVED">Status: RESOLVED</option>
                        </select>

                        <button
                          onClick={() => handleDeleteTicket(t.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 transition"
                          title="Delete ticket record"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="pt-3 space-y-2.5">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Customer Inquiry</div>
                        <div className="text-xs text-slate-900 font-medium mt-0.5 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                          {t.userQuery}
                        </div>
                      </div>

                      {t.conversationSummary && (
                        <div>
                          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Escalation Context / TeleNova Reason</div>
                          <div className="text-xs text-slate-700 mt-0.5">{t.conversationSummary}</div>
                        </div>
                      )}

                      {/* Human Agent Resolution Notes */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                            Human Agent Action & Notes
                          </span>
                          {editingNotes[t.id] !== undefined && editingNotes[t.id] !== (t.agentNotes || '') && (
                            <button
                              onClick={() => handleSaveNotes(t.id)}
                              disabled={isSaving}
                              className="flex items-center gap-1 text-[11px] font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-200 transition"
                            >
                              <Save className="w-3 h-3" />
                              <span>{isSaving ? 'Saving...' : 'Save Note'}</span>
                            </button>
                          )}
                        </div>
                        <input
                          type="text"
                          value={notesValue}
                          onChange={(e) => setEditingNotes({ ...editingNotes, [t.id]: e.target.value })}
                          placeholder="Type resolution notes or agent assigned (e.g. 'Customer called back; tariff confirmed')..."
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-800 transition"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Telemetry Audit Log Tab */
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Live Turn Telemetry & RAG Audit</h3>
              <p className="text-xs text-slate-500">Every spoken or typed interaction logged with response times and source citations</p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 rounded-md border border-slate-200 text-slate-700">
              {turnLogs.length} Total Turns Logged
            </span>
          </div>

          {turnLogs.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
              <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium">No customer turns logged yet.</p>
              <p className="text-xs text-slate-400 mt-1">Interactions on the Customer Desk will stream into this telemetry feed.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {turnLogs.map((log) => (
                <div key={log.id} className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 uppercase">Lang: {log.languageCode}</span>
                      <span>·</span>
                      <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="font-mono text-slate-700 font-semibold">
                      TTFA: {log.timeToFirstAudioMs}ms · Total: {log.totalTurnDurationMs}ms
                    </div>
                  </div>

                  <div className="text-slate-900 font-medium">
                    <span className="text-slate-400 font-normal">Customer: </span>
                    "{log.userSpeechTranscript}"
                  </div>

                  <div className="text-slate-700 bg-slate-50 p-2 rounded border border-slate-100">
                    <span className="text-slate-400 font-normal">Assistant: </span>
                    {log.llmSpokenAnswer || log.llmWrittenAnswer?.slice(0, 150) + '...'}
                  </div>

                  {log.retrievedSources && log.retrievedSources.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-0.5">
                      <span className="font-semibold text-slate-700">Sources:</span>
                      {log.retrievedSources.map((s: any, idx: number) => (
                        <span key={idx} className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-700">
                          {s.docId} ({s.sectionTitle})
                        </span>
                      ))}
                      {log.similarityScore !== undefined && (
                        <span className="ml-auto text-emerald-700 font-semibold">
                          Cosine: {log.similarityScore.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
