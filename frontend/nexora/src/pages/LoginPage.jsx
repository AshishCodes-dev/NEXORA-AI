import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import AuthLayout from '../components/auth/AuthLayout';
import AuthPanel from '../components/auth/AuthPanel';
import AuthHeader from '../components/auth/AuthHeader';
import AuthInput from '../components/auth/AuthInput';
import AuthError from '../components/auth/AuthError';
import GoogleAuthButton from '../components/auth/GoogleAuthButton';
import { springs } from '../motion/transitions';
import { Link } from '../router/RouterContext';

/**
 * LoginPage
 * Premium NEXORA operator authentication console.
 * Features strict client validation, multi-state UX (idle, loading, error, success),
 * duplicate submission protection, and visual Google OAuth placeholder.
 */
export default function LoginPage() {
  const prefersReducedMotion = useReducedMotion();

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Field Validation Errors
  const [fieldErrors, setFieldErrors] = useState({});

  // Operational UX State: 'idle' | 'loading' | 'error' | 'success'
  const [uiState, setUiState] = useState('idle');
  const [formError, setFormError] = useState(null);

  // Visual-only forgot password notice state
  const [forgotNotice, setForgotNotice] = useState(false);

  // Field Validation Handlers
  const validateField = (field, val) => {
    let err = null;
    if (field === 'email') {
      const trimmed = val.trim();
      if (!trimmed) {
        err = 'Operator email address is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        err = 'Invalid format. Provide a valid email (e.g. operator@nexora.ai).';
      }
    } else if (field === 'password') {
      if (!val) {
        err = 'Access credential password is required.';
      }
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });

    return !err;
  };

  const handleBlur = (field, currentVal) => {
    if (field === 'email') validateField('email', currentVal !== undefined ? currentVal : email);
    if (field === 'password') validateField('password', currentVal !== undefined ? currentVal : password);
  };

  // Form Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submission while in flight
    if (uiState === 'loading') return;

    // Clear previous errors
    setFormError(null);

    // Validate all fields
    const isEmailValid = validateField('email', email);
    const isPasswordValid = validateField('password', password);

    if (!isEmailValid || !isPasswordValid) {
      setFormError('Please resolve directive errors before initializing session.');
      setUiState('error');
      return;
    }

    // Set loading state
    setUiState('loading');

    // NOTE: This step establishes the UI Foundation.
    // The next phase will link directly to POST /api/auth/login.
    // Here we simulate the dispatch state transitions safely with no fake JWT generation.
    setTimeout(() => {
      // In Step 6A foundation, verify loading state and feedback without fabricating credentials
      setUiState('idle');
      setFormError('GATEWAY_READY: Authentication UI foundation primed. Direct API connection is scheduled for Step 6B.');
    }, 1200);
  };

  return (
    <AuthLayout systemSubtitle="SYSTEM ACCESS // SECURE CHANNEL">
      <AuthPanel>
        {/* Header Section */}
        <AuthHeader
          tag="SYSTEM ACCESS // SECURE GATEWAY"
          title="SYSTEM ACCESS"
          subtitle="Authenticate operator identity to open autonomous mission channels."
        />

        {/* Google OAuth (UI Only at Step 6A) */}
        <div className="mb-5">
          <GoogleAuthButton
            disabled={uiState === 'loading'}
            text="CONTINUE WITH GOOGLE"
          />
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[rgba(168,85,247,0.12)]" />
          </div>
          <span className="relative px-3 bg-[#07060B] text-[9.5px] font-mono tracking-widest text-[#554C5C] uppercase">
            OR // AUTHENTICATE VIA DIRECT CHANNEL
          </span>
        </div>

        {/* Form Error Banner */}
        {formError && (
          <div className="mb-5">
            <AuthError
              error={formError}
              title={
                formError.startsWith('GATEWAY_READY')
                  ? 'SYSTEM NOTICE // STEP 6A FOUNDATION'
                  : 'ERROR // VALIDATION_FAILED'
              }
            />
          </div>
        )}

        {/* Direct Authentication Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Email Input */}
          <AuthInput
            id="login-email"
            name="email"
            label="OPERATOR EMAIL"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) validateField('email', e.target.value);
            }}
            onBlur={(e) => handleBlur('email', e.target.value)}
            placeholder="operator@nexora.ai"
            autoComplete="email"
            required
            disabled={uiState === 'loading'}
            error={fieldErrors.email}
          />

          {/* Password Input + Forgot Directive Link */}
          <div>
            <AuthInput
              id="login-password"
              name="password"
              label="ACCESS KEY / PASSWORD"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) validateField('password', e.target.value);
              }}
              onBlur={(e) => handleBlur('password', e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
              disabled={uiState === 'loading'}
              error={fieldErrors.password}
            />

            {/* Forgot Password Link (Visual Only) */}
            <div className="flex items-center justify-end mt-1.5">
              <button
                type="button"
                onClick={() => setForgotNotice((prev) => !prev)}
                className="text-[11px] font-mono text-[#756B7D] hover:text-[#C084FC] transition-colors cursor-pointer"
              >
                Forgot access credentials?
              </button>
            </div>

            {forgotNotice && (
              <div className="mt-2 p-2 rounded bg-[#050508] border border-[rgba(168,85,247,0.12)] text-[10px] font-mono text-[#B8ADBF]">
                <span className="text-[#A855F7] font-bold">INFO: </span>
                Autonomous credential recovery is managed via workspace administrative enclave. Contact root cluster operator.
              </div>
            )}
          </div>

          {/* Submit Action Button */}
          <div className="pt-2">
            <motion.button
              type="submit"
              disabled={uiState === 'loading'}
              whileHover={uiState === 'loading' || prefersReducedMotion ? {} : { scale: 1.012 }}
              whileTap={uiState === 'loading' || prefersReducedMotion ? {} : { scale: 0.985 }}
              transition={springs.tactile}
              className={`w-full relative flex items-center justify-center gap-2.5 px-6 py-3 rounded-lg text-xs sm:text-sm font-mono font-bold tracking-wider transition-all duration-200 cursor-pointer min-h-[44px] ${
                uiState === 'loading'
                  ? 'bg-[#090710] border border-[rgba(168,85,247,0.30)] text-[#C084FC] cursor-not-allowed opacity-80'
                  : 'bg-[#090710] border border-[rgba(168,85,247,0.45)] border-t-[rgba(233,213,255,0.35)] text-[#E9D5FF] shadow-[0_0_18px_rgba(168,85,247,0.18)] hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.65)] hover:text-[#F5F1FA] hover:shadow-[0_0_24px_rgba(168,85,247,0.28)]'
              }`}
            >
              {uiState === 'loading' ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-[#C084FC]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>AUTHENTICATING...</span>
                </>
              ) : (
                <>
                  <span>LOGIN / INITIALIZE SESSION</span>
                  <span className="text-[#C084FC]">→</span>
                </>
              )}
            </motion.button>
          </div>
        </form>

        {/* Footer Navigation Switch */}
        <div className="mt-6 pt-5 border-t border-[rgba(168,85,247,0.10)] flex flex-wrap items-center justify-between text-xs font-mono gap-2 text-[#756B7D]">
          <span>Don&apos;t have a NEXORA account?</span>
          <Link
            to="/signup"
            className="text-[#C084FC] hover:text-[#E9D5FF] font-medium tracking-wide underline underline-offset-4 decoration-[rgba(168,85,247,0.3)] hover:decoration-[#C084FC] transition-colors"
          >
            CREATE ACCOUNT →
          </Link>
        </div>
      </AuthPanel>
    </AuthLayout>
  );
}
