import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * AuthInput
 * High-precision cyber-command input field with accessible labels,
 * electric violet focus rings, optional password reveal, and technical error indicators.
 */
export default function AuthInput({
  id,
  name,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  error,
  autoComplete,
  required = false,
  disabled = false,
  className = '',
}) {
  const [showPassword, setShowPassword] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {/* Input Label & Technical Marker */}
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-xs font-mono font-medium tracking-wider text-[#B8ADBF] flex items-center gap-1.5 cursor-pointer"
        >
          <span className="text-[#A855F7] font-bold">›</span>
          <span>{label}</span>
          {required && <span className="text-[#EF4444] text-[11px]">*</span>}
        </label>
        <span className="text-[9px] font-mono text-[#554C5C] tracking-widest uppercase">
          {isPassword ? 'CREDENTIAL' : 'PARAM'}
        </span>
      </div>

      {/* Input Container */}
      <div className="relative flex items-center">
        <input
          id={id}
          name={name || id}
          type={effectiveType}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full rounded-lg bg-[#050508] px-3.5 py-2.5 text-sm font-mono text-[#F5F1FA] placeholder-[#554C5C] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
            isPassword ? 'pr-11' : ''
          } ${
            error
              ? 'border border-[rgba(239,68,68,0.45)] focus:border-[#EF4444] focus:ring-1 focus:ring-[rgba(239,68,68,0.25)] shadow-[0_0_10px_rgba(239,68,68,0.12)]'
              : 'border border-[rgba(168,85,247,0.16)] focus:border-[#C084FC] focus:ring-1 focus:ring-[rgba(168,85,247,0.30)] hover:border-[rgba(168,85,247,0.28)] focus:outline-none'
          }`}
        />

        {/* Password Visibility Toggle */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            disabled={disabled}
            className="absolute right-2.5 p-1 text-[#756B7D] hover:text-[#E9D5FF] transition-colors rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-[rgba(168,85,247,0.4)]"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Inline Technical Validation Error */}
      {error && (
        <motion.div
          id={`${id}-error`}
          role="alert"
          initial={prefersReducedMotion ? {} : { opacity: 0, y: -2 }}
          animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 text-[11px] font-mono text-[#FCA5A5] pt-0.5"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444] shrink-0 animate-pulse" />
          <span>{error}</span>
        </motion.div>
      )}
    </div>
  );
}
