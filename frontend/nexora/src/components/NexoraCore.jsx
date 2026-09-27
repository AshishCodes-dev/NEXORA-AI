export default function NexoraCore({
  state = 'executing',
  size = 'md',
  className = '',
}) {
  const sizeDimensions = {
    sm: 'w-40 h-40',
    md: 'w-56 h-56 sm:w-64 sm:h-64',
    lg: 'w-64 h-64 sm:w-80 sm:h-80',
  };

  return (
    <div
      className={`relative flex items-center justify-center select-none ${
        sizeDimensions[size] || sizeDimensions.md
      } ${className}`}
    >
      {/* Refined Smooth Violet Atmospheric Bloom: Fading Into Black Void */}
      <div
        className="absolute inset-0 rounded-full blur-[80px] opacity-50 pointer-events-none transition-all duration-700"
        style={{
          background: `radial-gradient(circle at 50% 50%, rgba(168, 85, 247, 0.24) 0%, rgba(109, 40, 217, 0.12) 35%, rgba(53, 20, 92, 0.05) 60%, transparent 80%)`,
        }}
      />

      {/* SVG Robotic & Orbital Layer */}
      <svg
        viewBox="0 0 280 280"
        className="w-full h-full relative z-10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Layered Multi-Stop Electric Violet Core Gradient */}
          <radialGradient id="electricVioletCoreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#F5F1FA" stopOpacity="1" />
            <stop offset="18%" stopColor="#E9D5FF" stopOpacity="0.95" />
            <stop offset="38%" stopColor="#C084FC" stopOpacity="0.80" />
            <stop offset="62%" stopColor="#A855F7" stopOpacity="0.40" />
            <stop offset="85%" stopColor="#6D28D9" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#010202" stopOpacity="0" />
          </radialGradient>

          {/* Optical Violet Bloom Filter */}
          <filter id="violetBloomFilter" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.5" result="blur1" />
            <feGaussianBlur stdDeviation="10" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Outer Ring: rgba(109, 40, 217, 0.12) */}
        <circle
          cx="140"
          cy="140"
          r="126"
          stroke="rgba(109, 40, 217, 0.12)"
          strokeWidth="1"
          strokeDasharray="3 7"
        />

        {/* Precision Tactical Tick Marks */}
        <line x1="140" y1="6" x2="140" y2="18" stroke="rgba(168, 85, 247, 0.12)" strokeWidth="1" />
        <line x1="140" y1="262" x2="140" y2="274" stroke="rgba(168, 85, 247, 0.12)" strokeWidth="1" />
        <line x1="6" y1="140" x2="18" y2="140" stroke="rgba(168, 85, 247, 0.12)" strokeWidth="1" />
        <line x1="262" y1="140" x2="274" y2="140" stroke="rgba(168, 85, 247, 0.12)" strokeWidth="1" />

        {/* 2. Primary Orbital Ring: rgba(192, 132, 252, 0.45) with Technical Segments */}
        <g className="animate-spin-slow origin-center">
          {/* Base Muted Track */}
          <circle
            cx="140"
            cy="140"
            r="108"
            stroke="rgba(109, 40, 217, 0.16)"
            strokeWidth="0.8"
            strokeDasharray="4 8"
          />
          {/* Primary Ring: rgba(192, 132, 252, 0.45) */}
          <circle
            cx="140"
            cy="140"
            r="108"
            stroke="rgba(192, 132, 252, 0.45)"
            strokeWidth="1.2"
            strokeDasharray="45 85 25 55"
          />
          {/* Technical Segments: rgba(233, 213, 255, 0.42) */}
          <circle
            cx="140"
            cy="140"
            r="108"
            stroke="rgba(233, 213, 255, 0.42)"
            strokeWidth="1.4"
            strokeDasharray="14 175 16 115"
          />
          {/* Active Orbital Satellite Node: #C084FC */}
          <circle cx="140" cy="32" r="2.8" fill="#C084FC" />
          <circle cx="140" cy="32" r="5.5" stroke="#A855F7" strokeWidth="0.8" opacity="0.45" />

          {/* Secondary Telemetry Node: Pale Violet */}
          <circle cx="140" cy="248" r="1.8" fill="#E9D5FF" opacity="0.65" />
        </g>

        {/* 3. Secondary Orbital Ring: rgba(168, 85, 247, 0.22) Counter-Rotating */}
        <g className="animate-spin-reverse origin-center">
          <circle
            cx="140"
            cy="140"
            r="82"
            stroke="rgba(168, 85, 247, 0.07)"
            strokeWidth="1"
          />
          <circle
            cx="140"
            cy="140"
            r="82"
            stroke="rgba(168, 85, 247, 0.22)"
            strokeWidth="1.1"
            strokeDasharray="30 65 15 45"
          />
          {/* Micro Telemetry Particles */}
          <circle cx="222" cy="140" r="2" fill="#C084FC" opacity="0.8" />
          <circle cx="58" cy="140" r="1.4" fill="#756B7D" opacity="0.5" />
        </g>

        {/* 4. Stationary Segmented Inner Horizon */}
        <circle
          cx="140"
          cy="140"
          r="58"
          stroke="rgba(168, 85, 247, 0.08)"
          strokeWidth="0.8"
          strokeDasharray="2 5"
        />

        {/* 5. Pulsing Glowing Core Nucleus: Multi-layered Violet Containment */}
        <g className="animate-core-pulse origin-center">
          {/* Outer Deep Violet Bloom Filter: #6D28D9 */}
          <circle
            cx="140"
            cy="140"
            r="44"
            fill="url(#electricVioletCoreGlow)"
            filter="url(#violetBloomFilter)"
          />

          {/* Deep Surface Core Sphere */}
          <circle
            cx="140"
            cy="140"
            r="28"
            fill="#050508"
            stroke="#A855F7"
            strokeWidth="1.2"
            strokeOpacity="0.65"
          />

          {/* Main Energy: Electric Purple (#A855F7) */}
          <circle
            cx="140"
            cy="140"
            r="18"
            fill="#A855F7"
            opacity="0.80"
          />

          {/* Inner Glow: Bright Violet (#C084FC) */}
          <circle
            cx="140"
            cy="140"
            r="10"
            fill="#C084FC"
            opacity="0.90"
          />

          {/* Core Center: Pale Violet (#E9D5FF) */}
          <circle
            cx="140"
            cy="140"
            r="5"
            fill="#E9D5FF"
            opacity="0.98"
          />
        </g>

        {/* Micro Telemetry Cardinal Points */}
        <circle cx="140" cy="116" r="1" fill="#E9D5FF" opacity="0.6" />
        <circle cx="140" cy="164" r="1" fill="#E9D5FF" opacity="0.6" />
        <circle cx="116" cy="140" r="1" fill="#E9D5FF" opacity="0.6" />
        <circle cx="164" cy="140" r="1" fill="#E9D5FF" opacity="0.6" />
      </svg>
    </div>
  );
}
