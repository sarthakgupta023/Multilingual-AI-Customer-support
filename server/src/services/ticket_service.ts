import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  customerLanguage: string;
  userQuery: string;
  conversationSummary?: string;
  status: TicketStatus;
  assignedAgent?: string;
  agentNotes?: string;
  createdAt: string;
  updatedAt?: string;
}

// In-memory tickets store for local dev / demo
const localTickets: SupportTicket[] = [
  {
    id: 'seed-ticket-1',
    ticketNumber: 'TN-SR-482910',
    customerLanguage: 'hi',
    userQuery: 'क्या मुझे टेलीनोवा से 50,000 रुपये का पर्सनल लोन मिल सकता है?',
    conversationSummary: 'Customer inquired about banking/personal loans not offered by TeleNova.',
    status: 'OPEN',
    createdAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
  },
  {
    id: 'seed-ticket-2',
    ticketNumber: 'TN-SR-918372',
    customerLanguage: 'ta',
    userQuery: 'கார்ப்பரேட் லீஸ்டு லைன் இணைய இணைப்பு பெறுவது எப்படி?',
    conversationSummary: 'Customer requesting custom enterprise leased-line fiber setup.',
    status: 'IN_PROGRESS',
    assignedAgent: 'Rahul Sharma (Tier-2)',
    agentNotes: 'Forwarded to TeleNova B2B Enterprise team in Chennai circle.',
    createdAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  }
];

export class TicketService {
  private client: SupabaseClient | null = null;

  constructor() {
    if (config.supabase.url && config.supabase.serviceKey) {
      this.client = createClient(config.supabase.url, config.supabase.serviceKey);
    }
  }

  public async createTicket(
    customerLanguage: string,
    userQuery: string,
    conversationSummary?: string
  ): Promise<SupportTicket> {
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `TN-SR-${randomSuffix}`;

    const newTicket: SupportTicket = {
      id: crypto.randomUUID(),
      ticketNumber,
      customerLanguage,
      userQuery,
      conversationSummary: conversationSummary || 'Customer requested assistance regarding unlisted telecom policy.',
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (this.client) {
      try {
        const { error } = await this.client.from('support_tickets').insert({
          id: newTicket.id,
          ticket_number: newTicket.ticketNumber,
          customer_language: newTicket.customerLanguage,
          user_query: newTicket.userQuery,
          conversation_summary: newTicket.conversationSummary,
          status: newTicket.status,
        });
        if (error) {
          console.warn('[TicketService] Supabase insert failed, stored locally:', error.message);
        }
      } catch (err) {
        console.warn('[TicketService] Supabase unavailable, storing in-memory');
      }
    }

    localTickets.unshift(newTicket);
    console.log(`[TicketService] Created ticket: ${ticketNumber}`);
    return newTicket;
  }

  public updateTicket(id: string, updates: Partial<SupportTicket>): SupportTicket | null {
    const idx = localTickets.findIndex(t => t.id === id || t.ticketNumber === id);
    if (idx === -1) return null;

    localTickets[idx] = {
      ...localTickets[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (this.client) {
      const ticketToSync = localTickets[idx];
      this.client
        .from('support_tickets')
        .update({
          status: ticketToSync.status,
          conversation_summary: ticketToSync.conversationSummary,
        })
        .eq('id', ticketToSync.id)
        .then(() => {}, () => {});
    }

    return localTickets[idx];
  }

  public deleteTicket(id: string): boolean {
    const idx = localTickets.findIndex(t => t.id === id || t.ticketNumber === id);
    if (idx === -1) return false;
    localTickets.splice(idx, 1);
    return true;
  }

  public getTickets(): SupportTicket[] {
    return localTickets;
  }

  public getStats() {
    const total = localTickets.length;
    const open = localTickets.filter(t => t.status === 'OPEN').length;
    const inProgress = localTickets.filter(t => t.status === 'IN_PROGRESS').length;
    const resolved = localTickets.filter(t => t.status === 'RESOLVED').length;
    return { total, open, inProgress, resolved };
  }
}

export const ticketService = new TicketService();
