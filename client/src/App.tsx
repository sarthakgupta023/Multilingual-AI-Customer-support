import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Radio,
  PhoneCall,
  Sliders,
  AlertTriangle,
  UserCheck,
  Headphones,
} from 'lucide-react';
import { LanguageSelector } from './components/LanguageSelector';
import { CitationsList, SourceCitation } from './components/CitationsList';
import { TicketModal } from './components/TicketModal';
import { LatencyMeter } from './components/LatencyMeter';
import { AdminSupportDesk } from './components/AdminSupportDesk';
import { StreamingAudioPlayer } from './audio/audio-player';

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
  const [viewMode, setViewMode] = useState<'customer' | 'admin'>('customer');
  const [selectedLang, setSelectedLang] = useState('en');
  const [sampleRateMode, setSampleRateMode] = useState<16000 | 8000>(16000);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [typedInput, setTypedInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('Ready · Tap microphone or type a question');
  const [openTicketCount, setOpenTicketCount] = useState(0);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Welcome to TeleNova Multilingual Customer Support. You can ask any question regarding prepaid plans, postpaid billing, SIM replacement, 5G Ultra, or roaming in your own language.',
      sources: [
        {
          docId: 'TN-POL-01',
          docTitle: 'TeleNova Policies Repository',
          sectionTitle: 'Automated Grounded Verification Active',
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

  // Fetch open tickets count for admin badge
  const updateTicketCount = () => {
    fetch('/api/tickets')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const open = data.filter((t: any) => t.status === 'OPEN').length;
          setOpenTicketCount(open);
        }
      })
      .catch(() => {});
  };

  // Initialize Audio Player & WebSocket
  useEffect(() => {
    audioPlayerRef.current = new StreamingAudioPlayer();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/voice`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'init', language: selectedLang, sampleRate: sampleRateMode }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'transcript') {
          setStatusText(`Customer: "${data.text}"`);
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
            setStatusText('TeleNova Knowledge Base: Searching policy documents...');
          }
        } else if (data.type === 'answer') {
          setIsProcessing(false);
          setStatusText(data.found ? 'Grounded response received · Playing audio...' : 'Inquiry not found in policy repository');
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
            updateTicketCount();
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
          setStatusText('Ready · Tap microphone or type a question');
        }
      } catch (e) {
        console.error('Error handling WebSocket message:', e);
      }
    };

    updateTicketCount();

    return () => {
      stopRecording();
      ws.close();
    };
  }, []);

  const handleLanguageChange = (lang: string) => {
    setSelectedLang(lang);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_language', language: lang, sampleRate: sampleRateMode }));
    }
  };

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

  useEffect(() => {
    if (viewMode === 'customer') {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, statusText, viewMode]);

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
          ? 'Listening in 8kHz Telephony Line mode... Speak clearly'
          : 'Listening in 16kHz HD Voice mode... Speak now'
      );
    } catch (err) {
      console.error('Failed to access microphone:', err);
      setStatusText('Microphone permission denied. Please use typed input.');
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
    setStatusText('Processing customer speech...');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

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
    setStatusText('Searching TeleNova policy documents...');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text_input', text: query }));
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto bg-white border-x border-slate-200 shadow-sm font-sans antialiased">
      {/* Classic Enterprise Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-sm">
            <Radio className="w-4 h-4 text-slate-100" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">TeleNova Telecom</span>
              <span className="h-3 w-px bg-slate-200" />
              <h1 className="font-bold text-sm text-slate-900 tracking-tight">Multilingual Customer Support</h1>
            </div>
            <p className="text-[11px] text-slate-500">Grounded Voice & Document Service Desk</p>
          </div>
        </div>

        {/* View Switcher Tabs: Customer Desk vs Human Support Admin */}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setViewMode('customer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === 'customer'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>Voice Customer Desk</span>
            </button>

            <button
              onClick={() => {
                setViewMode('admin');
                updateTicketCount();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                viewMode === 'admin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Human Support Admin</span>
              {openTicketCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                  {openTicketCount}
                </span>
              )}
            </button>
          </div>

          {viewMode === 'customer' && (
            <>
              {/* Telephony Quality Mode Button */}
              <button
                onClick={handleSampleRateToggle}
                title="Switch between 16kHz Studio HD and 8kHz Telephone line acoustic filter"
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  sampleRateMode === 8000
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {sampleRateMode === 8000 ? <PhoneCall className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{sampleRateMode === 8000 ? '8kHz Telephony' : '16kHz HD Voice'}</span>
              </button>

              <LanguageSelector selectedLanguage={selectedLang} onSelectLanguage={handleLanguageChange} />
            </>
          )}
        </div>
      </header>

      {/* Conditional View: Human Support Admin vs Customer Voice Desk */}
      {viewMode === 'admin' ? (
        <AdminSupportDesk onBackToCustomerDesk={() => setViewMode('customer')} />
      ) : (
        <>
          {/* Quick Policy Questions Bar */}
          <div className="px-6 py-2 bg-[#f8fafc] border-b border-slate-200/80 overflow-x-auto scrollbar-none flex gap-2">
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
                    setStatusText('Searching TeleNova policy documents...');
                    wsRef.current.send(JSON.stringify({ type: 'text_input', text: chip.q }));
                  }
                }}
                className="shrink-0 px-3 py-1 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 hover:text-slate-900 rounded-md border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition"
              >
                {chip.label}
              </button>
            ))}
          </div>

          {/* Conversation Transcript Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#f8fafc]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                    msg.sender === 'user'
                      ? 'bg-slate-900 text-white rounded-tr-sm shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                  }`}
                >
                  {/* Spoken indicator */}
                  {msg.spokenText && (
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1 mb-2.5 w-fit">
                      <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                      <span>Spoken Summary: "{msg.spokenText}"</span>
                    </div>
                  )}

                  {/* Written Answer */}
                  <div className="whitespace-pre-wrap">{msg.text}</div>

                  {/* Grounded Policy Citations */}
                  {msg.sources && <CitationsList sources={msg.sources} />}

                  {/* Out-of-Domain Ticket Notice */}
                  {msg.suggestTicket && (
                    <div className="mt-4 pt-3 border-t border-amber-200 bg-amber-50/60 -mx-4 -mb-4 p-3.5 rounded-b-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>This inquiry is not documented in TeleNova's public policies.</span>
                      </div>
                      <button
                        onClick={() => {
                          setActiveTicketQuery(msg.text);
                          setIsTicketModalOpen(true);
                        }}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition shrink-0"
                      >
                        Escalate to Human Agent Desk
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isProcessing && (
              <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 shadow-sm w-fit animate-pulse">
                <Radio className="w-3.5 h-3.5 text-slate-800 animate-spin" />
                <span>Searching verified TeleNova telecom policies...</span>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Active Listening Waveform Banner */}
          {isRecording && (
            <div className="flex items-center justify-center gap-2 py-2 bg-rose-50 border-t border-rose-200 text-xs font-semibold text-rose-800">
              <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping" />
              <span>Microphone Active · Streaming speech to Gnani Prisma STT...</span>
            </div>
          )}

          {/* Status & Latency Bar */}
          <div className="px-6 py-2 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-2 truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isRecording
                    ? 'bg-rose-500'
                    : isPlayingAudio
                    ? 'bg-blue-600 animate-pulse'
                    : 'bg-emerald-600'
                }`}
              />
              <span className="truncate font-medium text-slate-700">{statusText}</span>
            </div>

            <LatencyMeter ttfaMs={lastLatency.ttfa} totalMs={lastLatency.total} />
          </div>

          {/* Docked Classic Input Bar */}
          <div className="p-4 bg-white border-t border-slate-200">
            <div className="flex items-center gap-3">
              {/* Push-to-Talk Mic Button */}
              <button
                onClick={toggleRecording}
                aria-label={isRecording ? 'Stop speaking' : 'Tap to speak'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-sm shrink-0 ${
                  isRecording
                    ? 'bg-rose-600 text-white animate-mic-pulse'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Barge-in Stop Button */}
              {isPlayingAudio && (
                <button
                  onClick={() => {
                    if (audioPlayerRef.current) {
                      audioPlayerRef.current.stop();
                      setIsPlayingAudio(false);
                      setStatusText('Audio interrupted by user');
                    }
                  }}
                  title="Interrupt playback (Barge-in)"
                  className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 flex items-center gap-1.5 transition"
                >
                  <VolumeX className="w-3.5 h-3.5 text-slate-600" />
                  <span>Interrupt</span>
                </button>
              )}

              {/* Typed Input Form */}
              <form onSubmit={handleSendTyped} className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={typedInput}
                  onChange={(e) => setTypedInput(e.target.value)}
                  placeholder="Ask any question about TeleNova (English, हिन्दी, தமிழ், etc)..."
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-800 focus:ring-1 focus:ring-slate-800 transition"
                />
                <button
                  type="submit"
                  disabled={!typedInput.trim()}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      {/* Escalation Ticket Modal */}
      <TicketModal
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
        userQuery={activeTicketQuery || ''}
        customerLanguage={selectedLang}
        onTicketCreated={(ticket) => {
          updateTicketCount();
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              sender: 'assistant',
              text: `✅ Customer Support Ticket **${ticket.ticketNumber}** has been registered in the **Human Support Desk** queue. Our agent will contact you shortly.`,
              found: true,
            },
          ]);
        }}
      />
    </div>
  );
}
