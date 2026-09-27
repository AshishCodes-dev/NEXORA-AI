export default function TechnicalLabel({
  children,
  variant = 'default',
  className = '',
  size = 'sm',
}) {
  const variantStyles = {
    default: 'text-[#756B7D] bg-[#07060B]/90 border-[rgba(168,85,247,0.10)]',
    primary: 'text-[#C084FC] bg-[#A855F7]/[0.10] border-[rgba(168,85,247,0.25)] shadow-[0_0_8px_rgba(168,85,247,0.10)]',
    soft: 'text-[#E9D5FF] bg-[#090710] border-[rgba(168,85,247,0.12)]',
    success: 'text-[#39FF88] bg-[#39FF88]/[0.06] border-[#39FF88]/20',
    warning: 'text-[#FFB84D] bg-[#FFB84D]/[0.06] border-[#FFB84D]/20',
    error: 'text-[#FF5577] bg-[#FF5577]/[0.06] border-[#FF5577]/20',
  };

  const sizeStyles = {
    xs: 'text-[9px] px-1.5 py-0.5 tracking-wider',
    sm: 'text-[10px] sm:text-[11px] px-2 py-0.5 tracking-widest',
    md: 'text-xs px-2.5 py-1 tracking-wider',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono uppercase font-semibold rounded border ${
        variantStyles[variant] || variantStyles.default
      } ${sizeStyles[size] || sizeStyles.sm} ${className}`}
    >
      {children}
    </span>
  );
}
