import { motion, useReducedMotion } from 'motion/react';
import { panelEnter } from '../../motion/variants';

/**
 * AuthPanel
 * Elevated cyber-command panel container for login and registration consoles.
 */
export default function AuthPanel({ children, className = '' }) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      variants={prefersReducedMotion ? {} : panelEnter}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`relative w-full rounded-xl bg-[#07060B]/95 border border-[rgba(168,85,247,0.16)] border-t-2 border-t-[rgba(192,132,252,0.45)] shadow-[0_24px_64px_rgba(0,0,0,0.85)] p-6 sm:p-8 backdrop-blur-xl ${className}`}
    >
      {/* Corner Technical Watermarks */}
      <div className="absolute top-2.5 right-3 text-[9px] font-mono text-[#554C5C] tracking-widest uppercase select-none pointer-events-none">
        GATEWAY // 0xAUTH
      </div>

      {children}
    </motion.div>
  );
}
