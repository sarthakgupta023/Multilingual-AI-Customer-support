import WebSocket from 'ws';
import { GnaniSTTGateway } from '../gateway/gnani_stt.js';
import { GnaniTTSGateway } from '../gateway/gnani_tts.js';
import { ragService } from '../rag/index.js';
import { ConversationTurn } from '../rag/types.js';
import { ticketService } from '../services/ticket_service.js';
import { turnLogger } from '../services/turn_logger.js';

export function handleVoiceWebSocket(ws: WebSocket) {
  const sessionId = crypto.randomUUID();
  let currentLanguage = 'en';
  let currentSampleRate = 16000;
  const conversationHistory: ConversationTurn[] = [];

  let sttGateway: GnaniSTTGateway | null = null;
  let ttsGateway: GnaniTTSGateway | null = null;

  function initSTT(lang: string, sampleRate: number = currentSampleRate) {
    if (sttGateway) {
      sttGateway.close();
    }
    currentLanguage = lang;
    currentSampleRate = sampleRate;
    sttGateway = new GnaniSTTGateway(lang, sampleRate);
    ttsGateway = new GnaniTTSGateway(lang);

    sttGateway.on('transcript', async ({ text, isFinal }) => {
      // Send live transcript segment to frontend
      ws.send(JSON.stringify({ type: 'transcript', text, isFinal }));

      if (isFinal && text.trim().length > 1) {
        await processTurn(text.trim());
      }
    });

    sttGateway.connect().catch(err => {
      ws.send(JSON.stringify({ type: 'error', message: 'Failed to connect to speech recognition' }));
    });
  }

  async function processTurn(userText: string) {
    const turnStartTime = Date.now();
    let firstAudioTime: number | null = null;

    ws.send(JSON.stringify({ type: 'processing', status: 'searching_policies' }));
    conversationHistory.push({ role: 'user', content: userText });

    try {
      const answer = await ragService.answerQuestion(userText, currentLanguage, conversationHistory);
      conversationHistory.push({ role: 'assistant', content: answer.fullAnswer });

      // 1. Send text answer and sources to client
      ws.send(JSON.stringify({
        type: 'answer',
        fullAnswer: answer.fullAnswer,
        spokenAnswer: answer.spokenAnswer,
        sources: answer.sources,
        found: answer.found,
        suggestTicket: answer.suggestTicket,
        similarityScore: answer.similarityScore,
      }));

      // 2. Synthesize spoken answer with Timbre TTS
      if (ttsGateway && answer.spokenAnswer) {
        const sentences = answer.spokenAnswer
          .split(/(?<=[.?!।\n])\s+/)
          .map(s => s.trim())
          .filter(Boolean);

        for (const sentence of sentences) {
          const sentenceTTS = new GnaniTTSGateway(currentLanguage);

          sentenceTTS.on('audio_chunk', (base64Audio: string) => {
            if (!firstAudioTime) {
              firstAudioTime = Date.now();
              const ttfa = firstAudioTime - turnStartTime;
              ws.send(JSON.stringify({ type: 'latency_stat', ttfaMs: ttfa }));
            }
            ws.send(JSON.stringify({ type: 'audio_chunk', audio: base64Audio }));
          });

          await sentenceTTS.synthesizeSentence(sentence);
        }

        ws.send(JSON.stringify({ type: 'audio_complete' }));
      }

      const totalDuration = Date.now() - turnStartTime;
      const ttfa = firstAudioTime ? firstAudioTime - turnStartTime : totalDuration;

      // Log turn for evaluation
      await turnLogger.logTurn({
        sessionId,
        languageCode: currentLanguage,
        userSpeechTranscript: userText,
        retrievedSources: answer.sources,
        similarityScore: answer.similarityScore,
        llmWrittenAnswer: answer.fullAnswer,
        llmSpokenAnswer: answer.spokenAnswer,
        timeToFirstAudioMs: ttfa,
        totalTurnDurationMs: totalDuration,
      });

    } catch (err: any) {
      console.error('[VoiceHandler] Error processing turn:', err);
      ws.send(JSON.stringify({ type: 'error', message: err.message || 'Internal processing error' }));
    }
  }

  // Handle messages from client
  ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
    if (isBinary) {
      // Raw PCM audio chunk from microphone
      if (sttGateway) {
        sttGateway.sendAudioChunk(data as Buffer);
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'init':
          initSTT(msg.language || 'en', msg.sampleRate || 16000);
          ws.send(JSON.stringify({ type: 'ready', sessionId, language: currentLanguage, sampleRate: currentSampleRate }));
          break;

        case 'set_language':
          initSTT(msg.language, currentSampleRate);
          ws.send(JSON.stringify({ type: 'language_changed', language: currentLanguage, sampleRate: currentSampleRate }));
          break;

        case 'set_sample_rate':
          initSTT(currentLanguage, msg.sampleRate || 16000);
          ws.send(JSON.stringify({ type: 'sample_rate_changed', sampleRate: currentSampleRate }));
          break;

        case 'text_input':
          // Typed fallback
          if (msg.text) {
            ws.send(JSON.stringify({ type: 'transcript', text: msg.text, isFinal: true }));
            await processTurn(msg.text);
          }
          break;

        case 'create_ticket':
          const ticket = await ticketService.createTicket(
            currentLanguage,
            msg.query || 'Customer manual ticket request',
            msg.summary
          );
          ws.send(JSON.stringify({ type: 'ticket_created', ticket }));
          break;

        default:
          break;
      }
    } catch (e) {
      console.warn('[VoiceHandler] Invalid message format:', e);
    }
  });

  ws.on('close', () => {
    if (sttGateway) {
      sttGateway.close();
    }
    console.log(`[VoiceHandler] Session closed: ${sessionId}`);
  });
}
