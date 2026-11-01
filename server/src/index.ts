import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { handleVoiceWebSocket } from './ws/voice_handler.js';
import { ragService } from './rag/index.js';
import { ticketService } from './services/ticket_service.js';
import { turnLogger } from './services/turn_logger.js';
import { localVectorStore } from './rag/local_store.js';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize policy store
localVectorStore.init();

// REST Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VoiceDesk TeleNova Backend',
    gnaniMock: config.gnani.isMock,
    llmMock: config.llm.isMock,
    vectorStore: config.supabase.useLocalStore ? 'local-in-memory' : 'supabase-pgvector',
  });
});

// Typed text fallback endpoint
app.post('/api/ask', async (req, res) => {
  const { question, language = 'en', history = [] } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  const startTime = Date.now();
  try {
    const answer = await ragService.answerQuestion(question, language, history);
    const duration = Date.now() - startTime;

    await turnLogger.logTurn({
      sessionId: 'rest-session',
      languageCode: language,
      userSpeechTranscript: question,
      retrievedSources: answer.sources,
      similarityScore: answer.similarityScore,
      llmWrittenAnswer: answer.fullAnswer,
      llmSpokenAnswer: answer.spokenAnswer,
      timeToFirstAudioMs: duration,
      totalTurnDurationMs: duration,
    });

    res.json({ ...answer, latencyMs: duration });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process question' });
  }
});

// Support Ticket endpoints
app.post('/api/tickets', async (req, res) => {
  const { language = 'en', query, summary } = req.body;
  const ticket = await ticketService.createTicket(language, query || 'No query specified', summary);
  res.status(201).json(ticket);
});

app.get('/api/tickets', (req, res) => {
  res.json(ticketService.getTickets());
});

// Evaluation / Admin Turn logs endpoint
app.get('/api/admin/turns', (req, res) => {
  res.json(turnLogger.getLogs());
});

// HTTP & WebSocket Server setup
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/voice' });

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected to /ws/voice');
  handleVoiceWebSocket(ws);
});

server.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 VoiceDesk TeleNova Server running on port ${config.port}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${config.port}/ws/voice`);
  console.log(`🔒 Gnani Mode: ${config.gnani.isMock ? 'MOCK (No credits consumed)' : 'LIVE API'}`);
  console.log(`🧠 LLM Mode: ${config.llm.isMock ? 'MOCK' : 'LIVE API'}`);
  console.log(`=======================================================`);
});
