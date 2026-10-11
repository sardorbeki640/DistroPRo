import React from 'react';

export type JarvisState = 'idle' | 'wake' | 'listening' | 'thinking' | 'speaking' | 'offline';

const COLORS: Record<JarvisState, { main: string; glow: string }> = {
  idle: { main: '#38bdf8', glow: 'rgba(56,189,248,0.45)' },
  wake: { main: '#22d3ee', glow: 'rgba(34,211,238,0.45)' },
  listening: { main: '#f43f5e', glow: 'rgba(244,63,94,0.55)' },
  thinking: { main: '#fbbf24', glow: 'rgba(251,191,36,0.5)' },
  speaking: { main: '#67e8f9', glow: 'rgba(103,232,249,0.7)' },
  offline: { main: '#64748b', glow: 'rgba(100,116,139,0.3)' }
};

const SPEED: Record<JarvisState, [number, number, number]> = {
  idle: [40, 26, 60], wake: [30, 20, 45], listening: [14, 9, 20], thinking: [4, 3, 7], speaking: [18, 12, 26], offline: [0, 0, 0]
};

/**
 * The Jarvis "arc reactor": concentric rings that breathe when idle, ripple while listening, spin fast while thinking
 * and pulse with the voice (level 0..1) while speaking.
 */
export const ArcReactor: React.FC<{ state: JarvisState; level?: number; size?: number; onClick?: () => void }> = ({ state, level = 0, size = 300, onClick }) => {
  const c = COLORS[state];
  const [a, b, d] = SPEED[state];
  const pulse = state === 'speaking' ? 1 + Math.min(1, level) * 0.22 : 1;
  const spin = (sec: number, reverse = false) => (sec ? { animation: `jv-spin ${sec}s linear infinite${reverse ? ' reverse' : ''}`, transformOrigin: '150px 150px' } : {});
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="relative select-none" style={{ width: size, height: size }} onClick={onClick} role={onClick ? 'button' : undefined}>
      <style>{`
        @keyframes jv-spin { to { transform: rotate(360deg); } }
        @keyframes jv-breathe { 0%,100% { opacity:.55; transform: scale(.97); } 50% { opacity:1; transform: scale(1.03); } }
        @keyframes jv-ripple { 0% { transform: scale(.6); opacity:.9; } 100% { transform: scale(1.35); opacity:0; } }
      `}</style>
      {/* glow */}
      <div className="absolute inset-0 rounded-full" style={{ boxShadow: `0 0 ${60 + level * 80}px ${c.glow}, inset 0 0 60px ${c.glow}`, transition: 'box-shadow .12s' }} />
      {state === 'listening' && [0, 1, 2].map(i => (
        <div key={i} className="absolute inset-0 rounded-full border-2" style={{ borderColor: c.main, animation: `jv-ripple 1.8s ease-out ${i * 0.6}s infinite` }} />
      ))}
      <svg viewBox="0 0 300 300" width={size} height={size} className="relative">
        <defs>
          <radialGradient id="jv-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="35%" stopColor={c.main} stopOpacity="0.85" />
            <stop offset="100%" stopColor={c.main} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* outer tick ring */}
        <g style={spin(a)}>
          {ticks.map(i => {
            const ang = (i / 60) * Math.PI * 2;
            const r1 = 142, r2 = i % 5 === 0 ? 128 : 135;
            return <line key={i} x1={150 + r1 * Math.cos(ang)} y1={150 + r1 * Math.sin(ang)} x2={150 + r2 * Math.cos(ang)} y2={150 + r2 * Math.sin(ang)} stroke={c.main} strokeOpacity={i % 5 === 0 ? 0.9 : 0.4} strokeWidth={i % 5 === 0 ? 2 : 1} />;
          })}
        </g>
        {/* segmented ring */}
        <g style={spin(b, true)}>
          <circle cx="150" cy="150" r="112" fill="none" stroke={c.main} strokeWidth="6" strokeOpacity="0.75" strokeDasharray="38 14" />
        </g>
        <g style={spin(d)}>
          <circle cx="150" cy="150" r="96" fill="none" stroke={c.main} strokeWidth="1.5" strokeOpacity="0.6" strokeDasharray="4 6" />
          <path d="M150 58 A92 92 0 0 1 242 150" fill="none" stroke={c.main} strokeWidth="3" strokeOpacity="0.9" />
          <path d="M150 242 A92 92 0 0 1 58 150" fill="none" stroke={c.main} strokeWidth="3" strokeOpacity="0.9" />
        </g>
        {/* triangle of the reactor */}
        <g style={{ ...spin(b * 2), opacity: 0.8 }}>
          <polygon points="150,88 204,180 96,180" fill="none" stroke={c.main} strokeWidth="2" />
        </g>
        {/* core */}
        <g style={{ transform: `scale(${pulse})`, transformOrigin: '150px 150px', transition: 'transform .1s', animation: state === 'idle' || state === 'wake' ? 'jv-breathe 4s ease-in-out infinite' : undefined }}>
          <circle cx="150" cy="150" r="70" fill="url(#jv-core)" />
          <circle cx="150" cy="150" r="34" fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
};
