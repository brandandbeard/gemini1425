import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneCall,
  PhoneOff,
  Volume2,
  VolumeX,
  Zap,
  HelpCircle,
  Settings2,
  Sparkles,
  Send,
  MessageSquare,
  Radio,
  Cpu,
  ChevronDown,
  Layers,
  Activity,
  AlertCircle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { LiveAudioPlayer, LiveAudioRecorder } from './utils/audio.ts';
import { AudioOrb } from './components/AudioOrb.tsx';
import { GuideModal } from './components/GuideModal.tsx';
import { VoiceSelector, VOICES } from './components/VoiceSelector.tsx';
import { TranscriptView, TranscriptItem } from './components/TranscriptView.tsx';
import { RunAnywhereModal } from './components/RunAnywhereModal.tsx';
import { Globe } from 'lucide-react';

type CallStatus = 'idle' | 'connecting' | 'active' | 'speaking' | 'listening' | 'interrupted';

export default function App() {
  // Session & Connection State
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [model, setModel] = useState<'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking'>('gemini-3.8-live');
  const [voice, setVoice] = useState<string>('Zephyr');
  const [systemInstruction, setSystemInstruction] = useState<string>(
    'You are a friendly, witty, and deeply intelligent AI companion in a live voice conversation. Speak naturally, keep answers concise and engaging, and feel free to use the provided tools when relevant.'
  );

  // Audio & Video State
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isScreenEnabled, setIsScreenEnabled] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);

  // Telemetry & UI
  const [callDuration, setCallDuration] = useState(0);
  const [chunksReceived, setChunksReceived] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Ready to connect');
  const [showGuide, setShowGuide] = useState(false);
  const [showRunAnywhere, setShowRunAnywhere] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [typedMessage, setTypedMessage] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio References
  const audioPlayerRef = useRef<LiveAudioPlayer | null>(null);
  const audioRecorderRef = useRef<LiveAudioRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const meterIntervalRef = useRef<number | null>(null);

  // Initialize Audio Player on mount
  useEffect(() => {
    audioPlayerRef.current = new LiveAudioPlayer();
    audioRecorderRef.current = new LiveAudioRecorder();

    return () => {
      stopCall();
      audioPlayerRef.current?.close();
      audioRecorderRef.current?.stop();
    };
  }, []);

  // Format call timer
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  // Add transcript entry helper
  const addTranscript = useCallback((sender: 'user' | 'gemini' | 'tool' | 'system', text: string, extra?: any) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setTranscripts((prev) => {
      // If the last message is from the same sender and was recent, optionally append or create new item
      return [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          sender,
          text,
          timestamp: timeStr,
          toolDetails: extra?.toolDetails,
          isInterrupted: extra?.isInterrupted,
        },
      ];
    });
  }, []);

  // Start Call Handler
  const startCall = async () => {
    setErrorMessage(null);
    setCallStatus('connecting');
    setStatusMessage('Initiating audio session & WebSocket...');
    setCallDuration(0);
    setChunksReceived(0);

    try {
      // 1. Initialize audio player
      audioPlayerRef.current?.init();

      // 2. Connect WebSocket to server
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live-ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatusMessage('Connecting to Gemini Live TPU stream...');
        // Dispatch session start config
        ws.send(
          JSON.stringify({
            type: 'start',
            model,
            voice,
            systemInstruction,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'status') {
            if (msg.status === 'active') {
              setCallStatus('active');
              setStatusMessage('Live conversation active. Speak freely!');
              addTranscript('system', `Connected to ${model} with voice '${voice}'`);

              // Start audio recorder after connection is live
              startMicrophone();

              // Start Call Duration Timer
              if (!timerIntervalRef.current) {
                timerIntervalRef.current = window.setInterval(() => {
                  setCallDuration((prev) => prev + 1);
                }, 1000);
              }

              // Start Volume Meter Polling
              if (!meterIntervalRef.current) {
                meterIntervalRef.current = window.setInterval(() => {
                  const uVol = audioRecorderRef.current?.getVolumeLevel() || 0;
                  const aVol = audioPlayerRef.current?.getVolumeLevel() || 0;
                  setUserVolume(uVol);
                  setAiVolume(aVol);

                  // Update status dynamically
                  if (aVol > 0.05) {
                    setCallStatus('speaking');
                  } else if (uVol > 0.05) {
                    setCallStatus('listening');
                  } else {
                    setCallStatus('active');
                  }
                }, 80);
              }
            } else if (msg.status === 'idle' || msg.status === 'disconnected') {
              stopCall();
            }
          }

          if (msg.type === 'audio' && msg.data) {
            setChunksReceived((c) => c + 1);
            audioPlayerRef.current?.playChunk(msg.data);
          }

          if (msg.type === 'model_transcript' && msg.text) {
            // Append model speech transcript
            addTranscript('gemini', msg.text);
          }

          if (msg.type === 'tool_call') {
            addTranscript('tool', `Executed ${msg.name}`, {
              toolDetails: {
                name: msg.name,
                args: msg.args,
                result: msg.result,
              },
            });
          }

          if (msg.type === 'interrupted') {
            audioPlayerRef.current?.stopAndClear();
            setCallStatus('interrupted');
            setStatusMessage('Interrupted. Gemini stopped speaking.');
            addTranscript('system', 'Gemini interrupted by user');
            setTimeout(() => setCallStatus('active'), 1200);
          }

          if (msg.type === 'turn_complete') {
            // Model finished speaking turn
            setStatusMessage('Gemini listening...');
          }

          if (msg.type === 'error') {
            setErrorMessage(msg.message);
            setStatusMessage('Error encountered.');
            addTranscript('system', `Error: ${msg.message}`);
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setErrorMessage('Failed to connect to Live WebSocket server.');
        stopCall();
      };

      ws.onclose = () => {
        if (callStatus !== 'idle') {
          stopCall();
        }
      };
    } catch (err: any) {
      console.error('Start call error:', err);
      setErrorMessage(err.message || 'Failed to start call');
      stopCall();
    }
  };

  // Start microphone capture at 16kHz
  const startMicrophone = async () => {
    try {
      await audioRecorderRef.current?.start((base64Pcm) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !isMicMuted) {
          wsRef.current.send(
            JSON.stringify({
              type: 'audio',
              data: base64Pcm,
            })
          );
        }
      });
    } catch (micErr: any) {
      console.error('Microphone access error:', micErr);
      setErrorMessage('Microphone access denied or not available. You can still type messages into the live session.');
      addTranscript('system', 'Microphone not available. Keyboard input is ready.');
    }
  };

  // Stop Call Handler
  const stopCall = () => {
    // Stop timers
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (meterIntervalRef.current) {
      clearInterval(meterIntervalRef.current);
      meterIntervalRef.current = null;
    }
    stopVideoStream();

    // Stop audio
    audioRecorderRef.current?.stop();
    audioPlayerRef.current?.stopAndClear();

    // Close WebSocket
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
          wsRef.current.close();
        }
      } catch (e) {}
      wsRef.current = null;
    }

    setCallStatus('idle');
    setUserVolume(0);
    setAiVolume(0);
    setStatusMessage('Call ended. Ready to connect.');
  };

  // Toggle Mic
  const toggleMic = () => {
    if (isMicMuted) {
      audioRecorderRef.current?.resume();
      setIsMicMuted(false);
    } else {
      audioRecorderRef.current?.pause();
      setIsMicMuted(true);
    }
  };

  // Toggle Speaker / Output Audio
  const toggleSpeaker = () => {
    const next = !isSpeakerMuted;
    setIsSpeakerMuted(next);
    audioPlayerRef.current?.setMuted(next);
  };

  // Manual Interruption button
  const triggerInterrupt = () => {
    audioPlayerRef.current?.stopAndClear();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setCallStatus('interrupted');
    setTimeout(() => setCallStatus('active'), 1000);
  };

  // Camera vision stream
  const toggleVideo = async () => {
    if (isVideoEnabled) {
      stopVideoStream();
      setIsVideoEnabled(false);
      return;
    }

    try {
      stopVideoStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 15 } },
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsVideoEnabled(true);
      setIsScreenEnabled(false);

      startFrameStreaming();
    } catch (err: any) {
      console.error('Camera error:', err);
      setErrorMessage('Could not access camera: ' + err.message);
    }
  };

  // Screen share stream
  const toggleScreen = async () => {
    if (isScreenEnabled) {
      stopVideoStream();
      setIsScreenEnabled(false);
      return;
    }

    try {
      stopVideoStream();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 15 } },
      });
      videoStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsScreenEnabled(true);
      setIsVideoEnabled(false);

      stream.getVideoTracks()[0].onended = () => {
        stopVideoStream();
        setIsScreenEnabled(false);
      };

      startFrameStreaming();
    } catch (err: any) {
      console.error('Screen share error:', err);
    }
  };

  // Stop video/screen
  const stopVideoStream = () => {
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsVideoEnabled(false);
    setIsScreenEnabled(false);
  };

  // Stream video frames at 1 FPS (as mandated by Live API guideline)
  const startFrameStreaming = () => {
    if (videoIntervalRef.current) clearInterval(videoIntervalRef.current);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    videoIntervalRef.current = window.setInterval(() => {
      if (!videoRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      canvas.width = 480;
      canvas.height = (480 * video.videoHeight) / video.videoWidth;
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      const base64Jpeg = dataUrl.split(',')[1];

      wsRef.current.send(
        JSON.stringify({
          type: 'video',
          data: base64Jpeg,
        })
      );
    }, 1000); // 1 frame per second
  };

  // Send typed prompt directly into the Live session
  const handleSendTypedMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedMessage.trim()) return;

    const text = typedMessage.trim();
    setTypedMessage('');
    addTranscript('user', text);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'text',
          text,
        })
      );
    } else {
      // If call not active, start call with this message
      startCall().then(() => {
        setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'text', text }));
          }
        }, 1500);
      });
    }
  };

  const selectedVoiceMeta = VOICES.find((v) => v.id === voice) || VOICES[0];

  return (
    <div className="flex h-screen w-full flex-col bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Navigation Bar */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 px-4 sm:px-6 bg-slate-950/70 backdrop-blur-md z-30">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 text-white shadow-lg shadow-cyan-500/20">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">Gemini Live</h1>
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 border border-cyan-500/20">
                Voice & Multimodal
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Bidirectional real-time conversational AI</p>
          </div>
        </div>

        {/* Center Status Pill */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 text-xs">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              callStatus === 'active' || callStatus === 'speaking' || callStatus === 'listening'
                ? 'bg-emerald-400 animate-ping'
                : callStatus === 'connecting'
                ? 'bg-amber-400 animate-pulse'
                : 'bg-slate-500'
            }`}
          />
          <span className="font-medium text-slate-300">
            {callStatus === 'idle' && 'Disconnected'}
            {callStatus === 'connecting' && 'Connecting...'}
            {callStatus === 'active' && 'Live In-Call'}
            {callStatus === 'speaking' && 'Gemini Speaking'}
            {callStatus === 'listening' && 'Listening to You'}
            {callStatus === 'interrupted' && 'Interrupted'}
          </span>
          {callStatus !== 'idle' && (
            <span className="ml-2 font-mono text-[11px] text-cyan-400 border-l border-slate-700 pl-2">
              {formatTime(callDuration)}
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Run Anywhere / Standalone Button */}
          <button
            onClick={() => setShowRunAnywhere(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 text-xs font-semibold transition-all shadow-sm shadow-emerald-500/10"
          >
            <Globe className="h-4 w-4 text-emerald-400" />
            <span>Use Anywhere</span>
          </button>

          {/* Guide Modal Button */}
          <button
            onClick={() => setShowGuide(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-300 text-xs font-semibold transition-all shadow-sm"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">How to use Live</span>
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2 rounded-lg border text-slate-300 hover:text-white transition-all ${
              showSettings ? 'border-indigo-500 bg-indigo-950/40 text-white' : 'border-slate-800 bg-slate-900/60'
            }`}
            title="Voice & Model Settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {errorMessage && (
        <div className="flex items-center justify-between bg-red-950/80 border-b border-red-800 px-4 py-2.5 text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white text-xs underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Side: Call Stage / Visualizer */}
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto">
          {/* Quick Info Bar */}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-800">
                <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                <span className="font-mono text-slate-200">{model}</span>
              </span>
              <span className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-800">
                <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
                <span>Voice:</span>
                <strong className="text-white">{voice}</strong>
              </span>
            </div>

            {callStatus !== 'idle' && (
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
                <span>Audio In: 16kHz</span>
                <span>Audio Out: 24kHz</span>
                <span>Chunks: {chunksReceived}</span>
              </div>
            )}
          </div>

          {/* Central Interactive Orb & Stage */}
          <div className="my-auto flex flex-col items-center justify-center py-6 relative">
            {/* Hidden Video Canvas for Frame Streaming */}
            <video
              ref={videoRef}
              playsInline
              muted
              className={`rounded-2xl border-2 border-cyan-500/40 shadow-2xl bg-black mb-4 transition-all duration-300 ${
                isVideoEnabled || isScreenEnabled ? 'w-64 h-48 object-cover' : 'hidden'
              }`}
            />

            {(isVideoEnabled || isScreenEnabled) && (
              <div className="mb-4 flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-[11px] text-cyan-300">
                <Eye className="h-3.5 w-3.5 animate-pulse text-cyan-400" />
                <span>Streaming visual frames at 1 FPS to Gemini Live</span>
              </div>
            )}

            {/* Audio Reactive Orb */}
            <AudioOrb
              status={callStatus}
              userVolume={userVolume}
              aiVolume={aiVolume}
              size={260}
            />

            {/* Status Text & Subtitle */}
            <div className="mt-4 text-center">
              <p className="text-sm font-semibold text-slate-200 tracking-wide">{statusMessage}</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                {callStatus === 'idle'
                  ? 'Click "Start Live Call" to start duplex real-time speech conversation.'
                  : 'Speak into your microphone. Say anything or ask questions to interrupt and converse.'}
              </p>
            </div>

            {/* Quick Starter Conversation Prompts */}
            {callStatus === 'idle' && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2 max-w-xl">
                <button
                  onClick={() => {
                    setTypedMessage('What is the current time and user timezone?');
                    startCall();
                  }}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-xs transition-colors"
                >
                  🕒 "What is the current time?" (Tool Call)
                </button>
                <button
                  onClick={() => {
                    setTypedMessage('Can you calculate 256 * 14.5 for me?');
                    startCall();
                  }}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-xs transition-colors"
                >
                  ➗ "Calculate 256 * 14.5" (Math Tool)
                </button>
                <button
                  onClick={() => {
                    setTypedMessage('Give me a 30-second explanation of quantum computing in simple terms.');
                    startCall();
                  }}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-xs transition-colors"
                >
                  ⚛️ "Explain quantum computing simply"
                </button>
                <button
                  onClick={() => {
                    setTypedMessage('Roleplay as a supportive senior software architect doing a quick code sync.');
                    startCall();
                  }}
                  className="px-3 py-1.5 rounded-full border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-slate-300 text-xs transition-colors"
                >
                  💻 "Senior architect code sync"
                </button>
              </div>
            )}
          </div>

          {/* Bottom Live Call Controls Toolbar */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3 p-2 rounded-2xl border border-slate-800/90 bg-slate-900/80 backdrop-blur-md shadow-2xl">
              {/* Mic Toggle */}
              <button
                onClick={toggleMic}
                disabled={callStatus === 'idle'}
                className={`p-3 rounded-xl border transition-all ${
                  isMicMuted
                    ? 'border-red-500/50 bg-red-950/40 text-red-400'
                    : 'border-slate-700 bg-slate-800/80 text-white hover:bg-slate-700'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title={isMicMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMicMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              {/* Camera Vision Toggle */}
              <button
                onClick={toggleVideo}
                disabled={callStatus === 'idle'}
                className={`p-3 rounded-xl border transition-all ${
                  isVideoEnabled
                    ? 'border-cyan-500 bg-cyan-950/40 text-cyan-400 shadow-md shadow-cyan-500/20'
                    : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title="Toggle Webcam Vision (1 FPS)"
              >
                {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
              </button>

              {/* Screen Share Vision Toggle */}
              <button
                onClick={toggleScreen}
                disabled={callStatus === 'idle'}
                className={`p-3 rounded-xl border transition-all ${
                  isScreenEnabled
                    ? 'border-indigo-500 bg-indigo-950/40 text-indigo-400 shadow-md shadow-indigo-500/20'
                    : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                title="Toggle Screen Sharing Vision (1 FPS)"
              >
                <Monitor className="h-5 w-5" />
              </button>

              {/* Main Call Start / End Button */}
              {callStatus === 'idle' ? (
                <button
                  onClick={startCall}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-indigo-600 to-purple-600 text-white shadow-xl shadow-cyan-500/25 hover:brightness-110 active:scale-95 transition-all"
                >
                  <PhoneCall className="h-5 w-5" />
                  <span>Start Live Call</span>
                </button>
              ) : (
                <button
                  onClick={stopCall}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-red-600 hover:bg-red-500 text-white shadow-xl shadow-red-600/25 active:scale-95 transition-all"
                >
                  <PhoneOff className="h-5 w-5" />
                  <span>End Call</span>
                </button>
              )}

              {/* Interrupt Button */}
              <button
                onClick={triggerInterrupt}
                disabled={callStatus === 'idle'}
                className="flex items-center gap-1.5 px-3.5 py-3 rounded-xl border border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300 text-xs font-semibold disabled:opacity-40 transition-all"
                title="Instantly stop Gemini playback"
              >
                <Zap className="h-4 w-4" />
                <span className="hidden sm:inline">Interrupt</span>
              </button>

              {/* Speaker Toggle */}
              <button
                onClick={toggleSpeaker}
                className={`p-3 rounded-xl border transition-all ${
                  isSpeakerMuted
                    ? 'border-amber-500/50 bg-amber-950/40 text-amber-400'
                    : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
                title={isSpeakerMuted ? 'Unmute Audio Playback' : 'Mute Audio Playback'}
              >
                {isSpeakerMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
            </div>

            {/* In-Call Text Input Bar */}
            <form
              onSubmit={handleSendTypedMessage}
              className="w-full max-w-xl flex items-center gap-2 bg-slate-900/70 border border-slate-800 rounded-xl p-1.5 pl-3 focus-within:border-cyan-500"
            >
              <input
                type="text"
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                placeholder="Or type a message directly into the live conversation..."
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!typedMessage.trim()}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold transition-all flex items-center gap-1"
              >
                <Send className="h-3 w-3" />
                <span>Send</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right Side: Live Transcript View */}
        <div className="w-80 lg:w-96 border-l border-slate-800/80 bg-slate-950/40 flex flex-col p-4 shrink-0 hidden md:flex">
          <TranscriptView
            items={transcripts}
            onClear={() => setTranscripts([])}
            voiceName={voice}
          />
        </div>
      </div>

      {/* Settings Drawer / Slide-Over */}
      {showSettings && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col p-6 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Settings2 className="h-5 w-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">Live Call Configuration</h3>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="py-6 space-y-6">
              {/* Model Choice */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Gemini Live Model
                </label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setModel('gemini-3.8-live')}
                    disabled={callStatus !== 'idle'}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      model === 'gemini-3.8-live'
                        ? 'border-cyan-500 bg-cyan-950/30'
                        : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800'
                    } ${callStatus !== 'idle' ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>gemini-3.8-live</span>
                      <span className="text-[10px] text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                        Ultra Low Latency
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Fastest turn-taking for real-time speech and multimodal conversational dialogue.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModel('gemini-3.8-live-extended-thinking')}
                    disabled={callStatus !== 'idle'}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      model === 'gemini-3.8-live-extended-thinking'
                        ? 'border-purple-500 bg-purple-950/30'
                        : 'border-slate-800 bg-slate-900/50 hover:bg-slate-800'
                    } ${callStatus !== 'idle' ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>gemini-3.8-live-extended-thinking</span>
                      <span className="text-[10px] text-purple-400 bg-purple-950 px-2 py-0.5 rounded border border-purple-500/30">
                        Deep Reasoning
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Uses thinking budget for complex technical reasoning, multi-step tool calls, and logic puzzles.
                    </p>
                  </button>
                </div>
              </div>

              {/* Voice Selection & System Prompt */}
              <VoiceSelector
                selectedVoice={voice}
                onSelectVoice={setVoice}
                systemInstruction={systemInstruction}
                onChangeInstruction={setSystemInstruction}
                disabled={callStatus !== 'idle'}
              />

              {callStatus !== 'idle' && (
                <p className="text-[11px] text-amber-400/80 bg-amber-950/30 p-2.5 rounded-lg border border-amber-500/20">
                  Settings are locked during an active call. End the call to adjust model or voice configuration.
                </p>
              )}
            </div>

            <div className="mt-auto pt-4 border-t border-slate-800">
              <button
                onClick={() => setShowSettings(false)}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guide & Architecture Modal */}
      <GuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />

      {/* Run Anywhere & Export Modal */}
      <RunAnywhereModal
        isOpen={showRunAnywhere}
        onClose={() => setShowRunAnywhere(false)}
        sharedAppUrl={
          typeof window !== 'undefined'
            ? (window.location.origin.includes('localhost')
                ? 'https://ais-pre-rhyd6xypf3o733gk6gjlaz-761573247142.asia-northeast1.run.app'
                : window.location.origin)
            : 'https://ais-pre-rhyd6xypf3o733gk6gjlaz-761573247142.asia-northeast1.run.app'
        }
      />
    </div>
  );
}
