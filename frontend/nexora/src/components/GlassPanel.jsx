import { motion } from 'motion/react';
import { panelEnter } from '../motion/variants';

export default function GlassPanel({
  children,
  className = '',
  elevated = false,
  glow = false,
  cornerAccents = true,
  animateEntrance = false,
  variants = panelEnter,
  onClick,
  ...props
}) {
  const bgClass = elevated ? 'bg-[#0C0912]/92' : 'bg-[rgba(7,6,11,0.86)]';
  const glowClass = glow
    ? 'shadow-[0_16px_48px_rgba(0,0,0,0.90),0_0_20px_rgba(168,85,247,0.08)]'
    : 'shadow-[0_16px_48px_rgba(0,0,0,0.85)]';

  const baseClassName = `relative rounded-xl border border-[rgba(168,85,247,0.10)] backdrop-blur-md transition-all duration-300 hover:border-[rgba(168,85,247,0.16)] hover:shadow-[0_16px_48px_rgba(0,0,0,0.92),0_0_16px_rgba(168,85,247,0.05)] ${bgClass} ${glowClass} ${className}`;

  const content = (
    <>
      {/* Subtle Violet Top Horizon Reflection */}
      <div className="absolute inset-x-3 top-0 h-[1px] bg-gradient-to-r from-transparent via-[#A855F7]/15 to-transparent pointer-events-none" />

      {/* Tactical Corner Accents */}
      {cornerAccents && (
        <>
          <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#A855F7]/30 rounded-tl-sm pointer-events-none" />
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#A855F7]/30 rounded-tr-sm pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#A855F7]/30 rounded-bl-sm pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#A855F7]/30 rounded-br-sm pointer-events-none" />
        </>
      )}

      {children}
    </>
  );

  if (animateEntrance) {
    return (
      <motion.div
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        onClick={onClick}
        className={baseClassName}
        {...props}
      >
        {content}
      </motion.div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={baseClassName}
      {...props}
    >
      {content}
    </div>
  );
}
