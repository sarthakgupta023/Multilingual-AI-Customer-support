import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  customerLanguage: string;
  userQuery: string;
  conversationSummary?: string;
  status: 'OPEN' | 'RESOLVED' | 'ESCALATED';
  createdAt: string;
}

// In-memory tickets store for local dev / demo
const localTickets: SupportTicket[] = [];

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

  public getTickets(): SupportTicket[] {
    return localTickets;
  }
}

export const ticketService = new TicketService();
