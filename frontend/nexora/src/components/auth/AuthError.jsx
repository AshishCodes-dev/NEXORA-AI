import { motion, useReducedMotion } from 'motion/react';

/**
 * AuthError
 * Reusable technical error presentation for authentication failures and validation alerts.
 * Features electric warning accents, glowing signal dot, and robotic error typography.
 */
export default function AuthError({
  error,
  title = 'ERROR // VALIDATION_FAILED',
  className = '',
}) {
  const prefersReducedMotion = useReducedMotion();

  if (!error) return null;

  return (
    <motion.div
      role="alert"
      initial={prefersReducedMotion ? {} : { opacity: 0, y: -4, scale: 0.99 }}
      animate={prefersReducedMotion ? {} : { opacity: 1, y: 0, scale: 1 }}
      exit={prefersReducedMotion ? {} : { opacity: 0, y: -4 }}
      transition={{ duration: 0.2 }}
      className={`flex items-start gap-3 p-3.5 rounded-lg bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.28)] shadow-[0_4px_16px_rgba(239,68,68,0.1)] ${className}`}
    >
      <span className="relative flex h-2 w-2 mt-1 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EF4444] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#EF4444]" />
      </span>

      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-mono font-bold tracking-widest text-[#F87171] uppercase mb-0.5">
          {title}
        </div>
        <p className="text-xs font-mono text-[#FCA5A5] leading-relaxed break-words">
          {error}
        </p>
      </div>
    </motion.div>
  );
}
