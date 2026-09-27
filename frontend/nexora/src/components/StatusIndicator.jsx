export default function StatusIndicator({
  state = 'executing',
  label,
  showPulse = true,
  className = '',
}) {
  const STATE_CONFIG = {
    idle: {
      color: '#A855F7',
      bg: 'bg-[#A855F7]/[0.08]',
      border: 'border-[rgba(168,85,247,0.18)]',
      text: 'text-[#B8ADBF]',
      dot: 'bg-[#A855F7]',
      defaultLabel: 'IDLE',
    },
    thinking: {
      color: '#C084FC',
      bg: 'bg-[#A855F7]/[0.10]',
      border: 'border-[rgba(192,132,252,0.22)]',
      text: 'text-[#E9D5FF]',
      dot: 'bg-[#C084FC]',
      defaultLabel: 'THINKING',
    },
    executing: {
      color: '#A855F7',
      bg: 'bg-[#A855F7]/[0.10]',
      border: 'border-[rgba(168,85,247,0.25)]',
      text: 'text-[#C084FC]',
      dot: 'bg-[#A855F7]',
      defaultLabel: 'EXECUTING',
    },
    verifying: {
      color: '#E9D5FF',
      bg: 'bg-[#A855F7]/[0.10]',
      border: 'border-[rgba(233,213,255,0.22)]',
      text: 'text-[#E9D5FF]',
      dot: 'bg-[#E9D5FF]',
      defaultLabel: 'VERIFYING',
    },
    warning: {
      color: '#FFB84D',
      bg: 'bg-[#FFB84D]/[0.08]',
      border: 'border-[#FFB84D]/25',
      text: 'text-[#FFB84D]',
      dot: 'bg-[#FFB84D]',
      defaultLabel: 'WARNING',
    },
    error: {
      color: '#FF5577',
      bg: 'bg-[#FF5577]/[0.08]',
      border: 'border-[#FF5577]/25',
      text: 'text-[#FF5577]',
      dot: 'bg-[#FF5577]',
      defaultLabel: 'ERROR',
    },
    success: {
      color: '#39FF88',
      bg: 'bg-[#A855F7]/[0.06]',
      border: 'border-[rgba(168,85,247,0.14)]',
      text: 'text-[#F5F1FA]',
      dot: 'bg-[#39FF88]',
      defaultLabel: 'ONLINE',
    },
  };

  const config = STATE_CONFIG[state] || STATE_CONFIG.executing;
  const displayLabel = label || config.defaultLabel;

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border backdrop-blur-sm ${config.bg} ${config.border} ${className}`}
    >
      <span className="relative flex h-2 w-2">
        {showPulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-50 ${config.dot}`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`} />
      </span>
      <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${config.text}`}>
        {displayLabel}
      </span>
    </div>
  );
}
