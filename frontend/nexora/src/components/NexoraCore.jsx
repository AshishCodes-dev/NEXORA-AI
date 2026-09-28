import { useReducedMotion } from 'motion/react';

const statePresets = {
  idle: {
    bloomOpacity: 'opacity-30',
    bloomGradient: 'rgba(168, 85, 247, 0.16) 0%, rgba(109, 40, 217, 0.08) 35%, transparent 75%',
    orbitalDuration: '34s',
    counterDuration: '42s',
    pulseDuration: '4.8s',
    nucleusColor: '#A855F7',
    centerGlow: '#C084FC',
    centerColor: '#E9D5FF',
    reticleStroke: 'rgba(168, 85, 247, 0.10)',
  },
  planning: {
    bloomOpacity: 'opacity-45',
    bloomGradient: 'rgba(192, 132, 252, 0.22) 0%, rgba(168, 85, 247, 0.12) 35%, transparent 75%',
    orbitalDuration: '22s',
    counterDuration: '28s',
    pulseDuration: '3.2s',
    nucleusColor: '#A855F7',
    centerGlow: '#C084FC',
    centerColor: '#F5F1FA',
    reticleStroke: 'rgba(192, 132, 252, 0.18)',
  },
  thinking: {
    bloomOpacity: 'opacity-45',
    bloomGradient: 'rgba(192, 132, 252, 0.22) 0%, rgba(168, 85, 247, 0.12) 35%, transparent 75%',
    orbitalDuration: '22s',
    counterDuration: '28s',
    pulseDuration: '3.2s',
    nucleusColor: '#A855F7',
    centerGlow: '#C084FC',
    centerColor: '#F5F1FA',
    reticleStroke: 'rgba(192, 132, 252, 0.18)',
  },
  researching: {
    bloomOpacity: 'opacity-55',
    bloomGradient: 'rgba(192, 132, 252, 0.28) 0%, rgba(168, 85, 247, 0.16) 40%, transparent 80%',
    orbitalDuration: '14s',
    counterDuration: '18s',
    pulseDuration: '2.2s',
    nucleusColor: '#A855F7',
    centerGlow: '#E9D5FF',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(192, 132, 252, 0.25)',
  },
  executing: {
    bloomOpacity: 'opacity-55',
    bloomGradient: 'rgba(192, 132, 252, 0.28) 0%, rgba(168, 85, 247, 0.16) 40%, transparent 80%',
    orbitalDuration: '14s',
    counterDuration: '18s',
    pulseDuration: '2.2s',
    nucleusColor: '#A855F7',
    centerGlow: '#E9D5FF',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(192, 132, 252, 0.25)',
  },
  analyzing: {
    bloomOpacity: 'opacity-45',
    bloomGradient: 'rgba(168, 85, 247, 0.22) 0%, rgba(109, 40, 217, 0.12) 35%, transparent 75%',
    orbitalDuration: '18s',
    counterDuration: '24s',
    pulseDuration: '2.5s',
    nucleusColor: '#C084FC',
    centerGlow: '#E9D5FF',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(168, 85, 247, 0.22)',
  },
  verifying: {
    bloomOpacity: 'opacity-50',
    bloomGradient: 'rgba(192, 132, 252, 0.26) 0%, rgba(168, 85, 247, 0.14) 35%, transparent 75%',
    orbitalDuration: '16s',
    counterDuration: '20s',
    pulseDuration: '1.8s',
    nucleusColor: '#C084FC',
    centerGlow: '#E9D5FF',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(233, 213, 255, 0.35)',
  },
  building: {
    bloomOpacity: 'opacity-60',
    bloomGradient: 'rgba(192, 132, 252, 0.32) 0%, rgba(168, 85, 247, 0.18) 42%, transparent 80%',
    orbitalDuration: '12s',
    counterDuration: '16s',
    pulseDuration: '1.9s',
    nucleusColor: '#A855F7',
    centerGlow: '#C084FC',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(192, 132, 252, 0.30)',
  },
  qa: {
    bloomOpacity: 'opacity-50',
    bloomGradient: 'rgba(57, 255, 136, 0.16) 0%, rgba(168, 85, 247, 0.14) 35%, transparent 75%',
    orbitalDuration: '18s',
    counterDuration: '22s',
    pulseDuration: '2.0s',
    nucleusColor: '#A855F7',
    centerGlow: '#39FF88',
    centerColor: '#F5F1FA',
    reticleStroke: 'rgba(57, 255, 136, 0.25)',
  },
  complete: {
    bloomOpacity: 'opacity-55',
    bloomGradient: 'rgba(57, 255, 136, 0.22) 0%, rgba(168, 85, 247, 0.14) 35%, transparent 80%',
    orbitalDuration: '30s',
    counterDuration: '36s',
    pulseDuration: '3.8s',
    nucleusColor: '#39FF88',
    centerGlow: '#39FF88',
    centerColor: '#FFFFFF',
    reticleStroke: 'rgba(57, 255, 136, 0.30)',
  },
};

export default function NexoraCore({
  state = 'executing',
  size = 'md',
  className = '',
}) {
  const prefersReducedMotion = useReducedMotion();
  const normalizedKey = (state || 'idle').toLowerCase();
  const config = statePresets[normalizedKey] || statePresets.idle;
  const animationPlayState = prefersReducedMotion ? 'paused' : 'running';

  const sizeDimensions = {
    sm: 'w-44 h-44',
    md: 'w-60 h-60 sm:w-72 sm:h-72',
    lg: 'w-72 h-72 sm:w-88 sm:h-88',
  };

  return (
    <div
      className={`relative flex items-center justify-center select-none ${
        sizeDimensions[size] || sizeDimensions.md
      } ${className}`}
    >
      {/* Refined Smooth Violet Atmospheric Bloom: Dynamic Aura based on State */}
      <div
        className={`absolute inset-0 rounded-full blur-[80px] pointer-events-none transition-all duration-700 ${config.bloomOpacity}`}
        style={{
          background: `radial-gradient(circle at 50% 50%, ${config.bloomGradient})`,
        }}
      />

      {/* Outer Tactical Coordinate Ring (Static Telemetry Reticle) */}
      <div className="absolute inset-2 rounded-full border border-[rgba(168,85,247,0.06)] pointer-events-none" />

      {/* SVG Robotic & Computational Orbital Layer */}
      <svg
        viewBox="0 0 320 320"
        className="w-full h-full relative z-10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Layered Multi-Stop Electric Violet Core Gradient */}
          <radialGradient id="electricVioletCoreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F5F1FA" stopOpacity="1" />
            <stop offset="16%" stopColor="#E9D5FF" stopOpacity="0.95" />
            <stop offset="36%" stopColor="#C084FC" stopOpacity="0.80" />
            <stop offset="60%" stopColor="#A855F7" stopOpacity="0.38" />
            <stop offset="84%" stopColor="#6D28D9" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#010202" stopOpacity="0" />
          </radialGradient>

          {/* Optical Violet Bloom Filter */}
          <filter id="violetBloomFilter" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur1" />
            <feGaussianBlur stdDeviation="9" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Outermost Segmented Coordinate Ring */}
        <circle
          cx="160"
          cy="160"
          r="148"
          stroke="rgba(109, 40, 217, 0.12)"
          strokeWidth="1"
          strokeDasharray="2 6"
        />

        {/* Outer Precision Degree Markers */}
        <circle cx="160" cy="12" r="1.5" fill="#C084FC" opacity="0.6" />
        <circle cx="160" cy="308" r="1.5" fill="#C084FC" opacity="0.6" />
        <circle cx="12" cy="160" r="1.5" fill="#C084FC" opacity="0.6" />
        <circle cx="308" cy="160" r="1.5" fill="#C084FC" opacity="0.6" />

        {/* Precision Cardinal Crosshairs & Reticle Ticks */}
        <line x1="160" y1="4" x2="160" y2="20" stroke="rgba(168, 85, 247, 0.22)" strokeWidth="1.2" />
        <line x1="160" y1="300" x2="160" y2="316" stroke="rgba(168, 85, 247, 0.22)" strokeWidth="1.2" />
        <line x1="4" y1="160" x2="20" y2="160" stroke="rgba(168, 85, 247, 0.22)" strokeWidth="1.2" />
        <line x1="300" y1="160" x2="316" y2="160" stroke="rgba(168, 85, 247, 0.22)" strokeWidth="1.2" />

        {/* Micro Angle Indices (45°, 135°, 225°, 315°) */}
        <line x1="50" y1="50" x2="58" y2="58" stroke="rgba(168, 85, 247, 0.15)" strokeWidth="1" />
        <line x1="270" y1="50" x2="262" y2="58" stroke="rgba(168, 85, 247, 0.15)" strokeWidth="1" />
        <line x1="50" y1="270" x2="58" y2="262" stroke="rgba(168, 85, 247, 0.15)" strokeWidth="1" />
        <line x1="270" y1="270" x2="262" y2="262" stroke="rgba(168, 85, 247, 0.15)" strokeWidth="1" />

        {/* 2. Concentric Outer Guidance Ring */}
        <circle
          cx="160"
          cy="160"
          r="132"
          stroke="rgba(168, 85, 247, 0.07)"
          strokeWidth="0.8"
        />

        {/* 3. Primary Orbital Ring: Clockwise Segmented Arcs */}
        <g
          className="animate-spin-slow origin-center"
          style={{
            animationDuration: config.orbitalDuration,
            animationPlayState,
          }}
        >
          {/* Base Muted Track */}
          <circle
            cx="160"
            cy="160"
            r="120"
            stroke="rgba(109, 40, 217, 0.15)"
            strokeWidth="0.8"
            strokeDasharray="4 8"
          />
          {/* Luminous Segmented Arc 1 */}
          <circle
            cx="160"
            cy="160"
            r="120"
            stroke="rgba(192, 132, 252, 0.45)"
            strokeWidth="1.2"
            strokeDasharray="50 95 30 65"
          />
          {/* High-Precision Telemetry Segments */}
          <circle
            cx="160"
            cy="160"
            r="120"
            stroke="rgba(233, 213, 255, 0.42)"
            strokeWidth="1.5"
            strokeDasharray="16 190 20 130"
          />
          {/* Active Orbital Satellite Node: Bright Violet with Halo */}
          <circle cx="160" cy="40" r="3" fill="#C084FC" />
          <circle cx="160" cy="40" r="6" stroke="#A855F7" strokeWidth="0.8" opacity="0.45" />

          {/* Secondary Telemetry Node: Pale Violet */}
          <circle cx="160" cy="280" r="2" fill="#E9D5FF" opacity="0.7" />
        </g>

        {/* 4. Secondary Counter-Rotating Telemetry Ring */}
        <g
          className="animate-spin-reverse origin-center"
          style={{
            animationDuration: config.counterDuration,
            animationPlayState,
          }}
        >
          <circle
            cx="160"
            cy="160"
            r="94"
            stroke="rgba(168, 85, 247, 0.08)"
            strokeWidth="1"
          />
          <circle
            cx="160"
            cy="160"
            r="94"
            stroke="rgba(168, 85, 247, 0.25)"
            strokeWidth="1.1"
            strokeDasharray="35 70 18 50"
          />
          {/* Orbital Micro Nodes */}
          <circle cx="254" cy="160" r="2.2" fill="#C084FC" opacity="0.8" />
          <circle cx="66" cy="160" r="1.5" fill="#756B7D" opacity="0.5" />
        </g>

        {/* 5. Stationary Segmented Inner Reticle */}
        <circle
          cx="160"
          cy="160"
          r="68"
          stroke={config.reticleStroke}
          strokeWidth="0.8"
          strokeDasharray="3 6"
        />

        {/* 6. Pulsing Glowing Core Nucleus: Multi-layered Violet Containment */}
        <g
          className="animate-core-pulse origin-center"
          style={{
            animationDuration: config.pulseDuration,
            animationPlayState,
          }}
        >
          {/* Outer Deep Violet Bloom Filter: #6D28D9 */}
          <circle
            cx="160"
            cy="160"
            r="50"
            fill="url(#electricVioletCoreGlow)"
            filter="url(#violetBloomFilter)"
          />

          {/* Deep Surface Core Sphere */}
          <circle
            cx="160"
            cy="160"
            r="32"
            fill="#050508"
            stroke="#A855F7"
            strokeWidth="1.2"
            strokeOpacity="0.65"
          />

          {/* Hexagonal Alignment Brackets around nucleus */}
          <circle
            cx="160"
            cy="160"
            r="24"
            stroke="rgba(192, 132, 252, 0.3)"
            strokeWidth="0.8"
            strokeDasharray="8 17"
          />

          {/* Main Energy: Electric Purple (#A855F7) */}
          <circle
            cx="160"
            cy="160"
            r="19"
            fill={config.nucleusColor}
            opacity="0.80"
          />

          {/* Inner Glow: Bright Violet (#C084FC) */}
          <circle
            cx="160"
            cy="160"
            r="11"
            fill={config.centerGlow}
            opacity="0.90"
          />

          {/* Core Center: Bright Pale Violet (#E9D5FF) */}
          <circle
            cx="160"
            cy="160"
            r="5.5"
            fill={config.centerColor}
            opacity="0.98"
          />
        </g>

        {/* Micro Telemetry Cardinal Points */}
        <circle cx="160" cy="134" r="1.2" fill="#E9D5FF" opacity="0.6" />
        <circle cx="160" cy="186" r="1.2" fill="#E9D5FF" opacity="0.6" />
        <circle cx="134" cy="160" r="1.2" fill="#E9D5FF" opacity="0.6" />
        <circle cx="186" cy="160" r="1.2" fill="#E9D5FF" opacity="0.6" />
      </svg>
    </div>
  );
}
