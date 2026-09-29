import { motion, useReducedMotion } from 'motion/react';
import { springs } from '../../motion/transitions';

/**
 * GoogleAuthButton
 * UI-only presentation for Google OAuth authentication at Step 6A.
 * Structured to integrate cleanly with Firebase/Google OAuth in subsequent steps
 * without requiring layout or styling refactors.
 */
export default function GoogleAuthButton({
  onClick,
  disabled = false,
  text = 'CONTINUE WITH GOOGLE',
  className = '',
}) {
  const prefersReducedMotion = useReducedMotion();

  const handleClick = (e) => {
    e.preventDefault();
    if (disabled) return;
    if (onClick) {
      onClick();
    } else {
      // Non-intrusive reminder in development console
      console.info('[NEXORA AUTH] Google OAuth entry point primed (Firebase integration scheduled for subsequent phase)');
    }
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      whileHover={disabled || prefersReducedMotion ? {} : { scale: 1.012 }}
      whileTap={disabled || prefersReducedMotion ? {} : { scale: 0.988 }}
      transition={springs.tactile}
      className={`w-full relative flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.18)] text-xs sm:text-sm font-mono font-medium text-[#E9D5FF] shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.45)] hover:text-[#F5F1FA] hover:shadow-[0_0_18px_rgba(168,85,247,0.15)] transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px] ${className}`}
    >
      {/* Official Google G Logo SVG */}
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        />
      </svg>

      <span className="tracking-wider">{text}</span>
    </motion.button>
  );
}
