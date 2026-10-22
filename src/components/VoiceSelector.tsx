import React, { useState } from 'react';
import { Play, Volume2, Check, Sparkles, Loader2 } from 'lucide-react';

export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  tone: string;
  description: string;
  accentColor: string;
}

export const VOICES: VoiceOption[] = [
  {
    id: 'Zephyr',
    name: 'Zephyr',
    gender: 'Neutral / Gentle',
    tone: 'Smooth, balanced, modern',
    description: 'Crisp and articulate with friendly, conversational pacing.',
    accentColor: 'from-cyan-500 to-blue-600',
  },
  {
    id: 'Puck',
    name: 'Puck',
    gender: 'Playful / Upbeat',
    tone: 'Spirited, engaging, curious',
    description: 'Bright and energetic, great for brainstorming and dynamic banter.',
    accentColor: 'from-amber-500 to-orange-600',
  },
  {
    id: 'Charon',
    name: 'Charon',
    gender: 'Deep / Resonant',
    tone: 'Authoritative, calm, grounded',
    description: 'Measured, serious, and reassuring for executive or technical discussions.',
    accentColor: 'from-purple-500 to-indigo-700',
  },
  {
    id: 'Kore',
    name: 'Kore',
    gender: 'Warm / Empathetic',
    tone: 'Gentle, soothing, articulate',
    description: 'Natural and comforting, ideal for coaching, learning, and mindfulness.',
    accentColor: 'from-pink-500 to-rose-600',
  },
  {
    id: 'Fenrir',
    name: 'Fenrir',
    gender: 'Strong / Confident',
    tone: 'Bold, commanding, direct',
    description: 'Focused and energetic with crisp articulation.',
    accentColor: 'from-emerald-500 to-teal-700',
  },
];

export const PERSONA_PRESETS = [
  {
    title: 'Helpful Partner',
    desc: 'Versatile, quick, and conversational companion',
    prompt:
      'You are a sharp, conversational, and charismatic AI partner in a live voice call. Keep spoken answers concise, lively, and natural. Avoid bullet points or markdown syntax since this is a voice conversation.',
  },
  {
    title: 'Tech Interviewer',
    desc: 'Challenges you with system design and coding questions',
    prompt:
      'You are an expert engineering interviewer conducting a live technical phone screen. Ask insightful questions, assess problem solving, and engage in realistic engineering dialogue.',
  },
  {
    title: 'Language Coach',
    desc: 'Practices conversational Spanish with corrections',
    prompt:
      'You are an encouraging Spanish conversation tutor. Converse with me primarily in Spanish, provide gentle pronunciation and grammar tips, and translate tricky terms when needed.',
  },
  {
    title: 'Creative Co-Founder',
    desc: 'Rapid-fire brainstorming on products and ideas',
    prompt:
      'You are my enthusiastic startup co-founder. Challenge my assumptions, brainstorm high-impact growth experiments, and give direct, rapid-fire feedback.',
  },
];

interface VoiceSelectorProps {
  selectedVoice: string;
  onSelectVoice: (voiceId: string) => void;
  systemInstruction: string;
  onChangeInstruction: (instruction: string) => void;
  disabled?: boolean;
}

export const VoiceSelector: React.FC<VoiceSelectorProps> = ({
  selectedVoice,
  onSelectVoice,
  systemInstruction,
  onChangeInstruction,
  disabled = false,
}) => {
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  const previewVoice = async (voiceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingVoiceId === voiceId) {
      if (audioElement) {
        audioElement.pause();
      }
      setPlayingVoiceId(null);
      return;
    }

    try {
      setPlayingVoiceId(voiceId);
      const res = await fetch('/api/gemini/voice-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice: voiceId,
          text: `Hello! I am ${voiceId}, your Google Gemini Live voice partner.`,
        }),
      });

      if (!res.ok) throw new Error('Preview failed');
      const data = await res.json();
      if (data.audioWavBase64) {
        const audio = new Audio(`data:audio/wav;base64,${data.audioWavBase64}`);
        setAudioElement(audio);
        audio.play();
        audio.onended = () => setPlayingVoiceId(null);
        audio.onerror = () => setPlayingVoiceId(null);
      } else {
        setPlayingVoiceId(null);
      }
    } catch (err) {
      console.error(err);
      setPlayingVoiceId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
          <Volume2 className="h-3.5 w-3.5 text-cyan-400" />
          Select Gemini Live Voice
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {VOICES.map((v) => {
            const isSelected = selectedVoice === v.id;
            const isPlaying = playingVoiceId === v.id;

            return (
              <div
                key={v.id}
                onClick={() => !disabled && onSelectVoice(v.id)}
                className={`relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer select-none ${
                  isSelected
                    ? 'border-cyan-500 bg-cyan-950/30 shadow-lg shadow-cyan-500/10'
                    : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-white flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full bg-gradient-to-tr ${v.accentColor}`} />
                      {v.name}
                    </span>
                    {isSelected && <Check className="h-4 w-4 text-cyan-400" />}
                  </div>
                  <div className="text-[11px] text-cyan-400/90 font-medium mt-0.5">{v.tone}</div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-tight">
                    {v.description}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">{v.gender}</span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(e) => previewVoice(v.id, e)}
                    className="flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-cyan-400 transition-colors px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-800"
                    title={`Listen to sample of ${v.name}`}
                  >
                    {isPlaying ? (
                      <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />
                    ) : (
                      <Play className="h-3 w-3 fill-current" />
                    )}
                    {isPlaying ? 'Playing' : 'Preview'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Persona Presets */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          Persona & Conversation Style
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {PERSONA_PRESETS.map((p) => (
            <button
              key={p.title}
              type="button"
              disabled={disabled}
              onClick={() => onChangeInstruction(p.prompt)}
              className="text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/40 hover:bg-slate-900 hover:border-slate-700 transition-colors"
            >
              <div className="text-xs font-semibold text-slate-200">{p.title}</div>
              <div className="text-[10px] text-slate-400 line-clamp-1">{p.desc}</div>
            </button>
          ))}
        </div>

        <div className="relative">
          <textarea
            value={systemInstruction}
            onChange={(e) => onChangeInstruction(e.target.value)}
            disabled={disabled}
            rows={2}
            className="w-full rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60 font-mono resize-none"
            placeholder="Custom system instructions for Gemini Live..."
          />
        </div>
      </div>
    </div>
  );
};
