import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, AudioLines, ChevronRight, CircleHelp, Headphones, History, LogOut, MessageCircle, Mic, MicOff, Plus, Send, ShieldCheck, Sparkles, Square, Ticket, Waves, X } from 'lucide-react';
import { LanguageSelector } from './components/LanguageSelector';
import { PolicyManager } from './components/PolicyManager';
import { StreamingAudioPlayer } from './audio/audio-player';

type User = { name: string; email: string; isAdmin: boolean };
type Message = { id: string; sender: 'user' | 'assistant'; text: string; sources?: { docId: string; docTitle: string; sectionTitle: string; pageNumber?: number; quote?: string }[]; suggestTicket?: boolean; createdAt?: string };
type Knowledge = { source: 'uploaded' | 'sample'; documents: { docId: string; title: string }[] };
type SupportTicket = { id: string; ticketNumber: string; customerEmail: string; customerLanguage: string; userQuery: string; conversationSummary: string; status: string; agentNotes?: string; createdAt: string };
const prompts = ['What plans are available?', 'I lost my SIM card', 'How do I switch to eSIM?', 'Am I eligible for unlimited 5G?'];
const policyPrompts = ['What does this policy cover?', 'Who is eligible?', 'What are the key requirements?', 'What should I do next?'];
const api = async (url: string, options?: RequestInit) => { const res = await fetch(url, options); const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Something went wrong'); return body; };
const json = (method: string, data: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export function App() {
  const [user, setUser] = useState<User | null>(null); const [knowledge, setKnowledge] = useState<Knowledge | null>(null); const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login'); const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState('');
  const [view, setView] = useState<'chat' | 'tickets' | 'admin'>('chat'); const [messages, setMessages] = useState<Message[]>([]); const [tickets, setTickets] = useState<SupportTicket[]>([]); const [language, setLanguage] = useState('en'); const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [recording, setRecording] = useState(false); const [speaking, setSpeaking] = useState(false); const [connected, setConnected] = useState(false); const [connectingSpeech, setConnectingSpeech] = useState(false); const [ticketQuery, setTicketQuery] = useState<string | null>(null); const [ticketDetails, setTicketDetails] = useState('');
  const ws = useRef<WebSocket | null>(null); const speechReadyRef = useRef(false); const recordingRef = useRef(false); const pendingSpeechConnection = useRef<{id: string; timer: number; resolve: () => void; reject: (error: Error) => void} | null>(null); const player = useRef<StreamingAudioPlayer | null>(null); const audioTurn = useRef<string | null>(null); const audioFinished = useRef(false); const audioSampleRate = useRef(24000); const pendingSpeech = useRef<{text: string; language: string} | null>(null); const stream = useRef<MediaStream | null>(null); const context = useRef<AudioContext | null>(null); const bottom = useRef<HTMLDivElement | null>(null); const languageRef = useRef(language); languageRef.current = language;
  const refresh = () => { api('/api/tickets').then(setTickets).catch(() => {}); };
  const refreshKnowledge = () => { api('/api/knowledge').then(setKnowledge).catch(() => setKnowledge(null)); };
  useEffect(() => { api('/api/auth/me').then(setUser).catch(() => {}).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!user) return;
    player.current = new StreamingAudioPlayer();
    player.current.onIdle = () => { if (audioFinished.current) { audioTurn.current = null; setSpeaking(false); } };
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined; let socket: WebSocket;
    api('/api/history').then(setMessages).catch(() => setError('Could not load your conversation history.'));
    refresh(); refreshKnowledge();
    const connect = () => {
      if (!active) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/voice`);
      ws.current = socket;
      socket.onopen = () => { setConnected(true); socket.send(JSON.stringify({ type: 'init', language: languageRef.current })); };
      socket.onclose = event => { setConnected(false); markSpeechReady(false); rejectSpeechConnection('Connection lost. Please try the microphone again.'); if (recordingRef.current) { stopMic(); if (active) setError('Microphone disconnected. Please tap it to try again.'); } setBusy(false); if (active && event.code === 1008) { setUser(null); setError('Your session has expired. Please sign in again.'); return; } if (active) timer = setTimeout(connect, 3000); };
      socket.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'ready' || data.type === 'speech_status') {
          markSpeechReady(!!data.speechReady);
          if (data.type === 'speech_status' && !data.speechReady && recordingRef.current) {
            stopMic(); setError('Speech recognition disconnected. Please tap the microphone to reconnect.');
          }
        }
        if (data.type === 'speech_ready') {
          const pending = pendingSpeechConnection.current;
          if (pending && pending.id === data.requestId) {
            window.clearTimeout(pending.timer); pendingSpeechConnection.current = null;
            markSpeechReady(!!data.speechReady);
            if (data.speechReady) pending.resolve();
            else pending.reject(new Error(data.message || 'Speech recognition could not connect. Please try again.'));
          }
        }
        if (data.type === 'transcript' && data.isFinal) { setMessages(m => [...m, { id: crypto.randomUUID(), sender: 'user' as const, text: data.text }].slice(-200)); setBusy(true); }
        if (data.type === 'answer') {
          setBusy(false);
          setMessages(m => [...m, { id: crypto.randomUUID(), sender: 'assistant' as const, text: data.fullAnswer, sources: data.sources, suggestTicket: data.suggestTicket }].slice(-200));
          audioTurn.current = data.turnId;
          audioFinished.current = false;
          pendingSpeech.current = {text: data.spokenAnswer || data.fullAnswer, language: data.language || languageRef.current};
        }
        if (data.type === 'tts_start' && data.turnId === audioTurn.current) { audioSampleRate.current = data.sampleRate; setSpeaking(true); }
        if (data.type === 'audio_chunk' && data.turnId === audioTurn.current) void player.current?.playChunk(data.audio, audioSampleRate.current);
        if (data.type === 'audio_complete' && data.turnId === audioTurn.current) {
          audioFinished.current = true;
          if (!player.current?.getIsPlaying()) { audioTurn.current = null; setSpeaking(false); }
        }
        if (data.type === 'tts_error' && data.turnId === audioTurn.current) {
          audioFinished.current = true;
          if (data.partial) { setError('Voice playback was interrupted. Please read the answer on screen.'); if (!player.current?.getIsPlaying()) setSpeaking(false); }
          else { audioTurn.current = null; setSpeaking(false); const pending = pendingSpeech.current; if (pending) speak(pending.text, pending.language); }
        }
        if (data.type === 'error') { setBusy(false); setError(data.message); }
      };
    };
    connect();
    return () => { active = false; if (timer) clearTimeout(timer); rejectSpeechConnection('Speech connection closed.'); socket?.close(); stopVoice(); stopMic(); };
  }, [user]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, view]);
  function stopVoice() { audioTurn.current = null; audioFinished.current = true; player.current?.stop(); window.speechSynthesis?.cancel(); if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({type:'stop_audio'})); setSpeaking(false); }
  function speak(text: string, lang: string) {
    if (!window.speechSynthesis || !text) { setError('Voice playback is unavailable. Please read the answer on screen.'); return; }
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.toLowerCase() === `${lang.toLowerCase()}-in`) || voices.find(v => v.lang.toLowerCase().split('-')[0] === lang.toLowerCase());
    if (!voice) { setError(`Voice playback is unavailable for this language on this device. Please read the answer on screen.`); return; }
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*#]/g, ''));
    utterance.lang = voice.lang; utterance.voice = voice; utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false); utterance.onerror = () => { setSpeaking(false); setError('Voice playback failed. Please read the answer on screen.'); };
    setSpeaking(true); speechSynthesis.speak(utterance);
  }
  function markSpeechReady(ready: boolean) { speechReadyRef.current = ready; }
  function rejectSpeechConnection(message: string) {
    const pending = pendingSpeechConnection.current;
    if (pending) { window.clearTimeout(pending.timer); pendingSpeechConnection.current = null; pending.reject(new Error(message)); }
  }
  function connectSpeech(): Promise<void> {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Connecting to the assistant. Please try again.'));
    rejectSpeechConnection('A new speech connection was requested.');
    markSpeechReady(false);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => { if (pendingSpeechConnection.current?.id === id) pendingSpeechConnection.current = null; reject(new Error('Speech recognition timed out. Please try again.')); }, 15000);
      pendingSpeechConnection.current = {id, timer, resolve, reject};
      try { socket.send(JSON.stringify({type:'start_listening', requestId:id})); }
      catch { rejectSpeechConnection('Could not connect the microphone. Please try again.'); }
    });
  }
  function stopMic() { recordingRef.current = false; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; void context.current?.close(); context.current = null; setRecording(false); }
  async function toggleMic() {
    player.current?.prepare();
    if (recordingRef.current) { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({type:'finish_listening'})); stopMic(); return; }
    if (connectingSpeech) return;
    stopVoice(); setError(''); setConnectingSpeech(true);
    try {
      await connectSpeech();
      const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      if (!speechReadyRef.current || ws.current?.readyState !== WebSocket.OPEN) throw new Error('Speech recognition disconnected. Please try again.');
      const ctx = new AudioContext(); context.current = ctx;
      await ctx.audioWorklet.addModule('/pcm-processor.js');
      if (!speechReadyRef.current || ws.current?.readyState !== WebSocket.OPEN) throw new Error('Speech recognition disconnected. Please try again.');
      const node = new AudioWorkletNode(ctx, 'pcm-processor');
      node.port.postMessage({ targetSampleRate: 16000 });
      node.port.onmessage = event => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(event.data); };
      ctx.createMediaStreamSource(media).connect(node); node.connect(ctx.destination);
      recordingRef.current = true; setRecording(true);
    } catch (e: any) { stopMic(); setError(e.message || 'Microphone unavailable. Please type your question.'); }
    finally { setConnectingSpeech(false); }
  }
  function send(text: string) { player.current?.prepare(); const value = text.trim(); if (!value || busy) return; if (ws.current?.readyState !== WebSocket.OPEN) { setError('Connecting to the assistant. Please try again.'); return; } stopVoice(); setMessages(m => [...m, { id: crypto.randomUUID(), sender: 'user' as const, text: value }].slice(-200)); setInput(''); setBusy(true); ws.current.send(JSON.stringify({ type: 'text_input', text: value })); }
  async function authenticate(e: React.FormEvent) { e.preventDefault(); setError(''); try { const result = await api(`/api/auth/${authMode}`, json('POST', { name, email, password })); setUser(result); setPassword(''); setView(result.isAdmin ? 'admin' : 'chat'); } catch (e: any) { setError(e.message); } }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); setUser(null); setMessages([]); setTickets([]); setKnowledge(null); setView('chat'); }
  async function createTicket(e: React.FormEvent) { e.preventDefault(); try { await api('/api/tickets', json('POST', { query: ticketQuery, summary: ticketDetails, language })); setTicketQuery(null); setTicketDetails(''); refresh(); setView('tickets'); } catch (e: any) { setError(e.message); } }
  async function updateTicket(id: string, updates: object) { try { await api(`/api/tickets/${id}`, json('PATCH', updates)); refresh(); } catch (e: any) { setError(e.message); } }
  if (loading) return <div className="loading">Loading your workspace…</div>;
  if (!user) return <div className="auth-shell"><div className="auth-story"><div className="brand brand-light"><span className="brand-mark"><Waves size={21}/></span><span>nova<span className="brand-accent">.</span></span></div><div className="auth-copy"><div className="eyebrow light"><span/> A BETTER WAY TO GET HELP</div><h1>Support that<br/><em>speaks your</em><br/>language.</h1><p>Real answers, in your own words. Meet your always-on companion for the policies that matter to you.</p><div className="auth-features"><span><AudioLines size={16}/> Speak naturally</span><span><ShieldCheck size={16}/> Answers with sources</span></div></div><div className="auth-footer">MADE FOR EVERY VOICE <span>✳</span> TELE ΝOVA</div></div><div className="auth-panel"><div className="auth-card"><div className="mobile-brand brand"><span className="brand-mark"><Waves size={20}/></span>nova<span className="brand-accent">.</span></div><div className="eyebrow">WELCOME TO NOVA</div><h2>{authMode === 'login' ? 'Good to see you again.' : 'Let’s get you started.'}</h2><p>{authMode === 'login' ? 'Sign in to pick up right where you left off.' : 'Create an account to keep your conversations and tickets together.'}</p><form onSubmit={authenticate} className="auth-form">{authMode === 'signup' && <label>Your name<input required value={name} onChange={e => setName(e.target.value)} placeholder="How should we call you?" /></label>}<label>Email address<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label><label>Password<input type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></label>{error && <div className="error">{error}</div>}<button className="primary large" type="submit">{authMode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={18}/></button></form><div className="auth-switch">{authMode === 'login' ? 'New to Nova?' : 'Already have an account?'} <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setError(''); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></div><div className="auth-note"><ShieldCheck size={15}/> Your conversations stay with your account.</div></div></div></div>;
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Waves size={20}/></span><span>nova<span className="brand-accent">.</span></span></div><div className="side-label">YOUR WORKSPACE</div><nav><button className={view === 'chat' ? 'nav-active' : ''} onClick={() => setView('chat')}><MessageCircle size={18}/> Assistant <ChevronRight size={15}/></button><button className={view === 'tickets' ? 'nav-active' : ''} onClick={() => { refresh(); setView('tickets'); }}><Ticket size={18}/> {user.isAdmin ? 'All tickets' : 'My tickets'} <span className="nav-count">{tickets.length}</span></button>{user.isAdmin && <button className={view === 'admin' ? 'nav-active' : ''} onClick={() => { refresh(); setView('admin'); }}><ShieldCheck size={18}/> Admin desk <ChevronRight size={15}/></button>}</nav><div className="side-bottom"><div className="side-help"><div className="side-help-icon"><Headphones size={19}/></div><strong>Here when you need us.</strong><p>Get help in your language, anytime.</p></div><div className="account"><div className="avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.email}</span></div><button aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={17}/></button></div></div></aside><main className="main"><header className="topbar"><div><span className="top-kicker">TELENOVA / {view === 'chat' ? 'ASSISTANT' : view === 'admin' ? 'ADMIN DESK' : 'TICKETS'}</span><h2>{view === 'chat' ? 'Your support space' : view === 'admin' ? 'Support operations' : 'Your support tickets'}</h2></div><div className="top-actions"><span className="online"><i/> {connected ? 'Connected' : 'Connecting'}</span>{view === 'chat' && <LanguageSelector selectedLanguage={language} disabled={recording || connectingSpeech} onSelectLanguage={l => { markSpeechReady(false); setLanguage(l); ws.current?.send(JSON.stringify({ type:'set_language', language:l })); }}/>}<button className="mobile-logout" onClick={logout}><LogOut size={18}/></button></div></header>{error && <div className="error-banner">{error}<button onClick={() => setError('')}><X size={16}/></button></div>}
  {view === 'chat' ? <div className="chat-layout"><div className="chat-scroll">{messages.length === 0 ? <div className="empty-chat"><div className="hero-icon"><Sparkles size={25}/></div><div className="eyebrow">YOUR POLICY COMPANION</div><h1>Hi {user.name.split(' ')[0]},<br/><span>how can I help?</span></h1><p>Ask me anything about the available policies.<br/>Type a question or speak in the language you’re most comfortable with.</p><div className="prompt-grid">{(knowledge?.source === 'uploaded' ? policyPrompts : prompts).map((p,i) => <button key={p} onClick={() => send(p)}><span className="prompt-number">0{i+1}</span><strong>{p}</strong><ArrowRight size={17}/></button>)}</div><div className="trust-line"><ShieldCheck size={15}/> {knowledge?.source === 'uploaded' ? `Searching ${knowledge.documents.length} uploaded ${knowledge.documents.length === 1 ? 'policy' : 'policies'}` : 'Searching sample policy documents'}</div></div> : <div className="conversation"><div className="conversation-heading"><div><span className="eyebrow">YOUR CONVERSATION</span><h3>Let’s figure it out together.</h3></div><span><History size={15}/> Saved to your account</span></div>{messages.map((m, i) => <div className={`message-row ${m.sender}`} key={m.id}><div className="message-avatar">{m.sender === 'assistant' ? <Sparkles size={15}/> : user.name.charAt(0).toUpperCase()}</div><div className="message-body"><div className="message-meta">{m.sender === 'assistant' ? 'NOVA ASSISTANT' : 'YOU'}</div><div className="message-bubble">{m.text}</div>{!!m.sources?.length && <div className="source-list"><span>REFERENCES</span>{m.sources.map((s,j) => <div key={j}><ShieldCheck size={13}/><span>{s.docTitle} · {s.docId} · {s.sectionTitle}{s.pageNumber ? ` · p. ${s.pageNumber}` : ''}{s.quote && <q className="source-quote">{s.quote}</q>}</span></div>)}</div>}{m.suggestTicket && <button className="escalate" onClick={() => setTicketQuery(messages.slice(0,i).reverse().find(x => x.sender === 'user')?.text || '')}>Talk to a human <ArrowRight size={15}/></button>}</div></div>)}{busy && <div className="thinking"><span/><span/><span/> Looking through the policies</div>}<div ref={bottom}/></div>}</div><div className="composer-wrap"><div className="composer-status"><span><i className={recording ? 'red' : ''}/> {connectingSpeech ? 'Connecting microphone…' : recording ? 'Listening — tap the microphone to finish' : busy ? 'Finding an answer…' : 'Ready to help'}</span>{speaking && <button onClick={stopVoice}><Square size={13} fill="currentColor"/> Stop voice</button>}</div><form className="composer" onSubmit={e => { e.preventDefault(); send(input); }}><button type="button" className={`mic ${recording ? 'recording' : ''}`} onClick={toggleMic} disabled={connectingSpeech} aria-label={recording ? 'Stop recording' : 'Start recording'}>{recording ? <MicOff size={19}/> : <Mic size={19}/>}</button><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask a question or tap the microphone..." maxLength={4000}/><button className="send" aria-label="Send message" disabled={!input.trim() || busy}><Send size={18}/></button></form><p>Questions and relevant policy excerpts may be sent to the AI provider. Check important answers against the source.</p></div></div> : <div className="tickets-view"><div className="section-intro"><div><div className="eyebrow">{user.isAdmin ? 'HUMAN SUPPORT' : 'WE’RE ON IT'}</div><h1>{user.isAdmin ? 'The support queue.' : 'Help, all in one place.'}</h1><p>{user.isAdmin ? 'Review customer requests and keep their progress up to date.' : 'Track your requests and see updates from our support team.'}</p></div>{!user.isAdmin && <button className="primary" onClick={() => setTicketQuery('')}><Plus size={17}/> New request</button>}</div>{view === 'admin' && user.isAdmin && <PolicyManager onChanged={refreshKnowledge}/>}<div className="ticket-stats"><div><span>ALL REQUESTS</span><strong>{tickets.length}</strong></div><div><span>OPEN</span><strong>{tickets.filter(t => t.status === 'OPEN').length}</strong></div><div><span>IN PROGRESS</span><strong>{tickets.filter(t => t.status === 'IN_PROGRESS').length}</strong></div><div><span>RESOLVED</span><strong>{tickets.filter(t => t.status === 'RESOLVED').length}</strong></div></div><div className="list-heading"><h3>{user.isAdmin ? 'Customer requests' : 'Request history'}</h3><span>{tickets.length} total</span></div>{tickets.length === 0 ? <div className="empty-tickets"><CircleHelp size={27}/><h3>No requests yet</h3><p>When you need a little extra help, your tickets will appear here.</p></div> : <div className="ticket-list">{tickets.map(t => <article className="ticket-card" key={t.id}><div className="ticket-top"><div><span className="ticket-id">{t.ticketNumber}</span><span className="ticket-date">{new Date(t.createdAt).toLocaleDateString()}</span></div><span className={`status ${t.status.toLowerCase()}`}>{t.status.replace('_',' ')}</span></div><h3>{t.userQuery}</h3>{user.isAdmin && <p>{t.customerEmail} · {t.customerLanguage.toUpperCase()}</p>}{t.conversationSummary && <p>{t.conversationSummary}</p>}{t.agentNotes && !user.isAdmin && <div className="agent-note"><strong>Support update</strong><br/>{t.agentNotes}</div>}{user.isAdmin && <div className="admin-controls"><select aria-label="Ticket status" value={t.status} onChange={e => updateTicket(t.id,{ status:e.target.value })}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option></select><input aria-label="Agent notes" defaultValue={t.agentNotes || ''} placeholder="Add a support update" onBlur={e => { if (e.target.value !== (t.agentNotes || '')) updateTicket(t.id,{ agentNotes:e.target.value }); }}/></div>}</article>)}</div>}</div>}</main>{ticketQuery !== null && <div className="modal-backdrop"><form className="modal" onSubmit={createTicket}><button type="button" className="modal-close" onClick={() => setTicketQuery(null)}><X size={19}/></button><div className="hero-icon small"><Headphones size={20}/></div><div className="eyebrow">HUMAN SUPPORT</div><h2>Let’s get you some help.</h2><p>Share a few details and your request will appear in your ticket history.</p><label>What do you need help with?<textarea required value={ticketQuery} onChange={e => setTicketQuery(e.target.value)} rows={3}/></label><label>Anything else we should know? <span>Optional</span><textarea value={ticketDetails} onChange={e => setTicketDetails(e.target.value)} rows={3} placeholder="Add context for the support team"/></label><button className="primary large">Create request <ArrowRight size={18}/></button></form></div>}</div>;
}
