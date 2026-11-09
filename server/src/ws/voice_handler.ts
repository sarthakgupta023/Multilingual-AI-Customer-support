import WebSocket from 'ws';
import { GnaniSTTGateway } from '../gateway/gnani_stt';
import { ragService } from '../rag/index';
import { ConversationTurn } from '../rag/types';
import { addMessage, PublicUser } from '../services/accounts';

export function handleVoiceWebSocket(ws: WebSocket, user: PublicUser) {
  let lang = 'en'; let rate = 16000; let stt: GnaniSTTGateway | null = null; let busy = false;
  const history: ConversationTurn[] = [];
  const send = (message: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
  const init = () => { stt?.close(); stt = new GnaniSTTGateway(lang, rate); stt.on('error', () => send({ type: 'error', message: 'Speech recognition is unavailable. You can type your question.' })); stt.on('transcript', ({ text, isFinal }) => { send({ type: 'transcript', text, isFinal }); if (isFinal && text.trim().length > 1) void turn(text.trim()); }); stt.connect().catch(() => send({ type: 'error', message: 'Speech recognition is unavailable. You can type your question.' })); };
  async function turn(text: string) { if (busy) { send({ type: 'error', message: 'Please wait for the current answer.' }); return; } busy = true; try { if (!user.isAdmin) await addMessage(user.id, 'user', text); const answer = await ragService.answerQuestion(text, lang, history); history.push({ role: 'user', content: text }, { role: 'assistant', content: answer.fullAnswer }); if (!user.isAdmin) await addMessage(user.id, 'assistant', answer.fullAnswer, { sources: answer.sources, suggestTicket: answer.suggestTicket }); send({ type: 'answer', ...answer }); } catch (e) { console.error(e); send({ type: 'error', message: 'Could not answer right now. Please try again.' }); } finally { busy = false; } }
  ws.on('message', (data, binary) => { if (binary) { stt?.sendAudioChunk(data as Buffer); return; } try { const msg = JSON.parse(data.toString()); if (msg.type === 'init' || msg.type === 'set_language' || msg.type === 'set_sample_rate') { lang = String(msg.language || lang).slice(0, 10); rate = msg.sampleRate === 8000 ? 8000 : 16000; init(); send({ type: 'ready' }); } else if (msg.type === 'text_input' && typeof msg.text === 'string' && msg.text.trim()) { void turn(msg.text.trim().slice(0, 4000)); } } catch { send({ type: 'error', message: 'Invalid message.' }); } });
  ws.on('close', () => stt?.close());
}
