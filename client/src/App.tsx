import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Radio,
  LifeBuoy,
  Sparkles,
  PhoneCall,
  Sliders,
  Clock,
} from 'lucide-react';
import { LanguageSelector } from './components/LanguageSelector.tsx';
import { CitationsList, SourceCitation } from './components/CitationsList.tsx';
import { TicketModal } from './components/TicketModal.tsx';
import { LatencyMeter } from './components/LatencyMeter.tsx';
import { StreamingAudioPlayer } from './audio/audio-player.ts';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  spokenText?: string;
  sources?: SourceCitation[];
  found?: boolean;
  suggestTicket?: boolean;
  ttfaMs?: number;
  totalMs?: number;
}

export function App() {
  const [selectedLang, setSelectedLang] = useState('en');
  const [sampleRateMode, setSampleRateMode] = useState<16000 | 8000>(16000);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('Tap mic or type a question');
  const [showTicketsDrawer, setShowTicketsDrawer] = useState(false);
  const [createdTickets, setCreatedTickets] = useState<any[]>([]);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Welcome to TeleNova Customer Support! How can I assist you today with your prepaid plans, billing, 5G Ultra, or SIM services?',
      sources: [
        {
          docId: 'TN-POL-01',
          docTitle: 'TeleNova Knowledge Base',
          sectionTitle: 'Automated Multilingual Verification Active',
        },
      ],
      found: true,
    },
  ]);

  const [activeTicketQuery, setActiveTicketQuery] = useState<string | null>(null);
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [lastLatency, setLastLatency] = useState<{ ttfa: number | null; total: number | null }>({
    ttfa: null,
    total: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<StreamingAudioPlayer | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Initialize Audio Player & WebSocket
  useEffect(() => {
    audioPlayerRef.current = new StreamingAudioPlayer();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/voice`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Connected');
      ws.send(JSON.stringify({ type: 'init', language: selectedLang, sampleRate: sampleRateMode }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'transcript') {
          setStatusText(data.text);
          if (data.isFinal) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                sender: 'user',
                text: data.text,
              },
            ]);
            setIsProcessing(true);
            setStatusText('TeleNova AI is searching documents...');
          }
        } else if (data.type === 'answer') {
          setIsProcessing(false);
          setStatusText(data.found ? 'Playing audio response...' : 'No matching policy found');
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender: 'assistant',
              text: data.fullAnswer,
              spokenText: data.spokenAnswer,
              sources: data.sources,
              found: data.found,
              suggestTicket: data.suggestTicket,
            },
          ]);

          if (data.suggestTicket) {
            setActiveTicketQuery(data.spokenAnswer);
          }
        } else if (data.type === 'latency_stat') {
          setLastLatency((prev) => ({ ...prev, ttfa: data.ttfaMs }));
        } else if (data.type === 'audio_chunk') {
          setIsPlayingAudio(true);
          if (audioPlayerRef.current) {
            audioPlayerRef.current.playChunk(data.audio);
          }
        } else if (data.type === 'audio_complete') {
          setIsPlayingAudio(false);
          setStatusText('Ready');
        }
      } catch (e) {
        console.error('Error handling WebSocket message:', e);
      }
    };

    // Load initial tickets from server
    fetch('/api/tickets')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setCreatedTickets(data);
      })
      .catch(() => {});

    return () => {
      stopRecording();
      ws.close();
    };
  }, []);

  // Language update
  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_language', language: lang, sampleRate: sampleRateMode }));
    }
  };

  // Sample Rate / Mode update
  const handleSampleRateToggle = () => {
    const nextRate = sampleRateMode === 16000 ? 8000 : 16000;
    setSampleRateMode(nextRate);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_sample_rate', sampleRate: nextRate }));
    }
    if (audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ targetSampleRate: nextRate });
    }
  };

  // Scroll to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, statusText]);

  // Start recording with AudioWorklet and optional 8kHz Telephony Filter
  const startRecording = async () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      setIsPlayingAudio(false);
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule('/src/audio/pcm-processor.js');
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
      audioWorkletNodeRef.current = workletNode;

      workletNode.port.postMessage({ targetSampleRate: sampleRateMode });

      workletNode.port.onmessage = (event) => {
        const pcmBuffer = event.data;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcmBuffer);
        }
      };

      const source = audioCtx.createMediaStreamSource(stream);

      // If 8kHz Telephony mode, pass audio through G.711 Telephony bandpass filter (300Hz - 3400Hz)
      if (sampleRateMode === 8000) {
        const highpass = audioCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 300;

        const lowpass = audioCtx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 3400;

        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(workletNode);
      } else {
        source.connect(workletNode);
      }

      workletNode.connect(audioCtx.destination);

      setIsRecording(true);
      setStatusText(
        sampleRateMode === 8000
          ? 'Listening in 8kHz Telephony Mode... Speak now'
          : 'Listening in 16kHz HD Voice... Speak now'
      );
    } catch (err) {
      console.error('Failed to access microphone:', err);
      setStatusText('Microphone permission denied. Use typed input.');
    }
  };

  const stopRecording = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsRecording(false);
    setStatusText('Processing speech...');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Typed input
  const handleSendTyped = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = typedInput.trim();
    if (!query) return;

    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      setIsPlayingAudio(false);
    }

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender: 'user',
        text: query,
      },
    ]);

    setTypedInput('');
    setIsProcessing(true);
    setStatusText('Searching TeleNova documents...');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text_input', text: query }));
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-slate-900 border-x border-slate-800 shadow-2xl relative">
      {/* TeleNova Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-white tracking-tight">TeleNova</h1>
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                VoiceDesk
              </span>
            </div>
            <p className="text-xs text-slate-400">Grounded Multilingual Voice Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Telephony 8kHz Mode Toggle (for Noise Canceller award) */}
          <button
            onClick={handleSampleRateToggle}
            title="Toggle between 16kHz HD Voice and 8kHz Telephone audio mode"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition ${
              sampleRateMode === 8000
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-300 hover:text-white'
            }`}
          >
            {sampleRateMode === 8000 ? <PhoneCall className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{sampleRateMode === 8000 ? '8kHz Telephony' : '16kHz HD'}</span>
          </button>

          {/* Tickets Drawer Button */}
          <button
            onClick={() => setShowTicketsDrawer(!showTicketsDrawer)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-xs text-slate-300 transition"
          >
            <LifeBuoy className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Tickets</span>
            {createdTickets.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-indigo-500 text-[10px] font-bold text-white flex items-center justify-center">
                {createdTickets.length}
              </span>
            )}
          </button>

          <LanguageSelector selectedLanguage={selectedLang} onSelectLanguage={handleLanguageChange} />
        </div>
      </header>

      {/* Suggested Quick Topics Bar */}
      <div className="px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 overflow-x-auto scrollbar-none flex gap-2">
        {[
          { label: 'Super599 Plan Details', q: 'What is the price and validity of the Super599 plan?' },
          { label: 'Lost SIM Card', q: 'मेरा सिम खो गया है क्या करूँ?' },
          { label: 'MNP Porting Rules', q: 'போர்ட் செய்ய UPC குறியீட்டை எவ்வாறு உருவாக்குவது?' },
          { label: '5G Ultra Eligibility', q: 'Which prepaid plans qualify for True Unlimited 5G?' },
          { label: 'APN Settings', q: 'What is the official APN setting for TeleNova?' },
          { label: 'Recharge Refund', q: 'How long does a refund take for a double deduction on recharge?' },
        ].map((chip, idx) => (
          <button
            key={idx}
            onClick={() => {
              setTypedInput(chip.q);
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                setMessages((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), sender: 'user', text: chip.q },
                ]);
                setIsProcessing(true);
                setStatusText('Searching TeleNova documents...');
                wsRef.current.send(JSON.stringify({ type: 'text_input', text: chip.q }));
              }
            }}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 hover:bg-slate-700/80 text-xs text-slate-300 hover:text-white rounded-lg border border-slate-700/60 transition"
          >
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>{chip.label}</span>
          </button>
        ))}
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl p-4 shadow-md ${
                msg.sender === 'user'
                  ? 'bg-indigo-600 text-white rounded-tr-sm'
                  : 'bg-slate-800/90 border border-slate-700/80 text-slate-100 rounded-tl-sm'
              }`}
            >
              {/* Spoken indicator */}
              {msg.spokenText && (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-300 mb-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Voice Summary: "{msg.spokenText}"</span>
                </div>
              )}

              {/* Full Text Answer */}
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</div>

              {/* Grounded Citations */}
              {msg.sources && <CitationsList sources={msg.sources} />}

              {/* Out-of-domain ticket prompt */}
              {msg.suggestTicket && (
                <div className="mt-4 pt-3 border-t border-amber-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-amber-300">
                    <LifeBuoy className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>Policy not found in TeleNova database</span>
                  </div>
                  <button
                    onClick={() => {
                      setActiveTicketQuery(msg.text);
                      setIsTicketModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow transition"
                  >
                    Raise Support Ticket
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex items-center gap-3 p-3 bg-slate-800/40 border border-slate-700/50 rounded-xl text-xs text-indigo-300 animate-pulse w-fit">
            <Radio className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Searching 12 verified TeleNova policies...</span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Live Audio Visualizer Bar when listening */}
      {isRecording && (
        <div className="flex items-center justify-center gap-1 py-2 bg-rose-950/30 border-t border-rose-500/20">
          <div className="w-1 h-3 bg-rose-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
          <div className="w-1 h-5 bg-rose-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
          <div className="w-1 h-4 bg-rose-400 rounded-full animate-bounce" />
          <div className="w-1 h-6 bg-rose-400 rounded-full animate-bounce [animation-delay:0.15s]" />
          <div className="w-1 h-3 bg-rose-400 rounded-full animate-bounce [animation-delay:0.3s]" />
          <span className="text-xs font-medium text-rose-300 ml-2">Streaming Audio to Gnani Prisma STT...</span>
        </div>
      )}

      {/* Status Bar */}
      <div className="px-6 py-2 bg-slate-950/80 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isRecording
                ? 'bg-rose-500 animate-ping'
                : isPlayingAudio
                ? 'bg-indigo-400 animate-pulse'
                : 'bg-emerald-500'
            }`}
          />
          <span className="font-medium text-slate-300">{statusText}</span>
        </div>

        <LatencyMeter ttfaMs={lastLatency.ttfa} totalMs={lastLatency.total} />
      </div>

      {/* Docked Control Area */}
      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <div className="flex items-center gap-3">
          {/* Main Giant Voice Button */}
          <button
            onClick={toggleRecording}
            aria-label={isRecording ? 'Stop recording voice' : 'Start speaking'}
            className={`relative p-4 rounded-2xl flex items-center justify-center transition shadow-lg ${
              isRecording
                ? 'bg-rose-600 text-white animate-pulse-ring'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
            }`}
          >
            {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          {/* Barge-in Stop Button */}
          {isPlayingAudio && (
            <button
              onClick={() => {
                if (audioPlayerRef.current) {
                  audioPlayerRef.current.stop();
                  setIsPlayingAudio(false);
                  setStatusText('Audio stopped by user');
                }
              }}
              title="Interrupt & Stop Voice Playback (Barge-in)"
              className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition text-xs flex items-center gap-1.5"
            >
              <VolumeX className="w-4 h-4" />
              <span className="hidden sm:inline">Interrupt</span>
            </button>
          )}

          {/* Typed Input Fallback Form */}
          <form onSubmit={handleSendTyped} className="flex-1 flex items-center gap-2">
            <input
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder="Ask anything about TeleNova in English, हिन्दी, தமிழ், etc..."
              className="flex-1 bg-slate-800 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
            />
            <button
              type="submit"
              disabled={!typedInput.trim()}
              className="p-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 hover:text-white rounded-xl border border-slate-700/80 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Tickets Drawer */}
      {showTicketsDrawer && (
        <div className="absolute inset-y-0 right-0 w-80 bg-slate-800 border-l border-slate-700 p-4 shadow-2xl z-30 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-700">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-100">
              <LifeBuoy className="w-4 h-4 text-indigo-400" />
              <span>Created Support Tickets</span>
            </div>
            <button
              onClick={() => setShowTicketsDrawer(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
            {createdTickets.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No support tickets created yet.</p>
            ) : (
              createdTickets.map((t) => (
                <div key={t.id} className="bg-slate-900/80 border border-slate-700 rounded-xl p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-indigo-300">{t.ticketNumber}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                      {t.status}
                    </span>
                  </div>
                  <div className="text-slate-300 truncate" title={t.userQuery}>
                    {t.userQuery}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(t.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Ticket Modal */}
      <TicketModal
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
        userQuery={activeTicketQuery || ''}
        customerLanguage={selectedLang}
        onTicketCreated={(ticket) => {
          setCreatedTickets((prev) => [ticket, ...prev]);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender: 'assistant',
              text: `✅ Support ticket **${ticket.ticketNumber}** created successfully for our human support team.`,
              found: true,
            },
          ]);
        }}
      />
    </div>
  );
}
