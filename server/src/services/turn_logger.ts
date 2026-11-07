import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';

export interface TurnLog {
  id: string;
  sessionId: string;
  languageCode: string;
  userSpeechTranscript: string;
  retrievedSources: any[];
  similarityScore: number;
  llmWrittenAnswer: string;
  llmSpokenAnswer: string;
  timeToFirstAudioMs: number;
  totalTurnDurationMs: number;
  createdAt: string;
}

const localTurnLogs: TurnLog[] = [];

export class TurnLogger {
  private client: SupabaseClient | null = null;

  constructor() {
    if (config.supabase.url && config.supabase.serviceKey) {
      this.client = createClient(config.supabase.url, config.supabase.serviceKey);
    }
  }

  public async logTurn(entry: Omit<TurnLog, 'id' | 'createdAt'>): Promise<TurnLog> {
    const log: TurnLog = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    if (this.client) {
      try {
        await this.client.from('turn_logs').insert({
          id: log.id,
          session_id: log.sessionId,
          language_code: log.languageCode,
          user_speech_transcript: log.userSpeechTranscript,
          retrieved_sources: log.retrievedSources,
          similarity_score: log.similarityScore,
          llm_written_answer: log.llmWrittenAnswer,
          llm_spoken_answer: log.llmSpokenAnswer,
          time_to_first_audio_ms: log.timeToFirstAudioMs,
          total_turn_duration_ms: log.totalTurnDurationMs,
        });
      } catch (e) {
        // Fallback to memory
      }
    }

    localTurnLogs.unshift(log);
    return log;
  }

  public getLogs(): TurnLog[] {
    return localTurnLogs;
  }
}

export const turnLogger = new TurnLogger();
