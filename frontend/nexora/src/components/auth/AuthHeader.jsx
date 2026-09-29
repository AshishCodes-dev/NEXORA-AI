/**
 * AuthHeader
 * Standardized tactical header for NEXORA authentication views.
 */
export default function AuthHeader({
  tag = 'SYSTEM ACCESS // SECURE CHANNEL',
  title = 'SYSTEM ACCESS',
  subtitle = 'Provide verified operator credentials to initialize your autonomous session.',
  className = '',
}) {
  return (
    <div className={`mb-6 ${className}`}>
      {/* Micro Status Beacon */}
      <div className="flex items-center gap-2 mb-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[#A855F7] shadow-[0_0_8px_#A855F7] animate-pulse" />
        <span className="text-[10px] font-mono tracking-widest uppercase text-[#C084FC] font-bold">
          {tag}
        </span>
      </div>

      {/* Dominant Console Title */}
      <h1 className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-[#F5F1FA] mb-2 leading-tight">
        {title}
      </h1>

      {/* Contextual Subtitle */}
      {subtitle && (
        <p className="text-xs sm:text-sm font-mono text-[#756B7D] leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}
