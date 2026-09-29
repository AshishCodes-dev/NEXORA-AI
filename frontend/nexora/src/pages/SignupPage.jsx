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
 * SignupPage
 * Premium operator onboarding and registration console for NEXORA.
 * Features comprehensive client-side validation (name, email format, 8+ char password, match check),
 * multi-state UX (idle, loading, error, success), and duplicate submission protection.
 */
export default function SignupPage() {
  const prefersReducedMotion = useReducedMotion();

  // Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Field Validation Errors
  const [fieldErrors, setFieldErrors] = useState({});

  // Operational UX State: 'idle' | 'loading' | 'error' | 'success'
  const [uiState, setUiState] = useState('idle');
  const [formError, setFormError] = useState(null);

  // Field Validation Handlers
  const validateField = (field, val, allValues = {}) => {
    let err = null;
    const currentName = allValues.name !== undefined ? allValues.name : name;
    const currentEmail = allValues.email !== undefined ? allValues.email : email;
    const currentPassword = allValues.password !== undefined ? allValues.password : password;
    const currentConfirm = allValues.confirmPassword !== undefined ? allValues.confirmPassword : confirmPassword;

    if (field === 'name') {
      const trimmed = val.trim();
      if (!trimmed) {
        err = 'Operator identifier name is required.';
      } else if (trimmed.length < 2) {
        err = 'Operator name must be at least 2 characters.';
      }
    } else if (field === 'email') {
      const trimmed = val.trim();
      if (!trimmed) {
        err = 'Operator email address is required.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        err = 'Invalid format. Provide a valid email (e.g. operator@nexora.ai).';
      }
    } else if (field === 'password') {
      if (!val) {
        err = 'Password credential is required.';
      } else if (val.length < 8) {
        err = 'Password must be at least 8 characters in length.';
      }
    } else if (field === 'confirmPassword') {
      if (!val) {
        err = 'Password confirmation is required.';
      } else if (val !== currentPassword) {
        err = 'Password credentials do not match.';
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
    const val = currentVal !== undefined ? currentVal : (
      field === 'name' ? name :
      field === 'email' ? email :
      field === 'password' ? password :
      confirmPassword
    );
    if (field === 'name') validateField('name', val);
    if (field === 'email') validateField('email', val);
    if (field === 'password') {
      validateField('password', val);
      if (confirmPassword) validateField('confirmPassword', confirmPassword, { password: val });
    }
    if (field === 'confirmPassword') validateField('confirmPassword', val, { password });
  };

  // Form Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent duplicate submission while in flight
    if (uiState === 'loading') return;

    // Clear previous errors
    setFormError(null);

    const values = { name, email, password, confirmPassword };
    const isNameValid = validateField('name', name, values);
    const isEmailValid = validateField('email', email, values);
    const isPasswordValid = validateField('password', password, values);
    const isConfirmValid = validateField('confirmPassword', confirmPassword, values);

    if (!isNameValid || !isEmailValid || !isPasswordValid || !isConfirmValid) {
      setFormError('Please resolve operator registration errors before dispatching.');
      setUiState('error');
      return;
    }

    // Set loading state
    setUiState('loading');

    // NOTE: This step establishes the UI Foundation.
    // The next phase will link directly to POST /api/auth/signup.
    // Here we simulate the dispatch state transitions safely with no fake database inserts.
    setTimeout(() => {
      setUiState('idle');
      setFormError('GATEWAY_READY: Operator account creation UI foundation primed. Direct API connection is scheduled for Step 6B.');
    }, 1200);
  };

  return (
    <AuthLayout systemSubtitle="OPERATOR REGISTRATION // ENCLAVE ACCESS">
      <AuthPanel>
        {/* Header Section */}
        <AuthHeader
          tag="ENCLAVE ACCESS // NEW OPERATOR"
          title="CREATE OPERATOR ACCOUNT"
          subtitle="Register credentials to deploy autonomous AI agents and manage directives."
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
            OR // REGISTER DIRECT OPERATOR IDENTITY
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
                  : 'ERROR // REGISTRATION_FAILED'
              }
            />
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Operator Name Input */}
          <AuthInput
            id="signup-name"
            name="name"
            label="OPERATOR NAME"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (fieldErrors.name) validateField('name', e.target.value);
            }}
            onBlur={(e) => handleBlur('name', e.target.value)}
            placeholder="e.g. Commander Sarah Chen"
            autoComplete="name"
            required
            disabled={uiState === 'loading'}
            error={fieldErrors.name}
          />

          {/* Email Input */}
          <AuthInput
            id="signup-email"
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

          {/* Password Input */}
          <AuthInput
            id="signup-password"
            name="password"
            label="MASTER ACCESS KEY (MIN 8 CHARS)"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (fieldErrors.password) validateField('password', e.target.value);
              if (confirmPassword && fieldErrors.confirmPassword) {
                validateField('confirmPassword', confirmPassword, { password: e.target.value });
              }
            }}
            onBlur={(e) => handleBlur('password', e.target.value)}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            required
            disabled={uiState === 'loading'}
            error={fieldErrors.password}
          />

          {/* Confirm Password Input */}
          <AuthInput
            id="signup-confirm-password"
            name="confirmPassword"
            label="CONFIRM ACCESS KEY"
            type="password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (fieldErrors.confirmPassword) {
                validateField('confirmPassword', e.target.value, { password });
              }
            }}
            onBlur={(e) => handleBlur('confirmPassword', e.target.value)}
            placeholder="Re-enter master access key"
            autoComplete="new-password"
            required
            disabled={uiState === 'loading'}
            error={fieldErrors.confirmPassword}
          />

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
                  <span>CREATING ACCOUNT...</span>
                </>
              ) : (
                <>
                  <span>CREATE ACCOUNT</span>
                  <span className="text-[#C084FC]">→</span>
                </>
              )}
            </motion.button>
          </div>
        </form>

        {/* Footer Navigation Switch */}
        <div className="mt-6 pt-5 border-t border-[rgba(168,85,247,0.10)] flex flex-wrap items-center justify-between text-xs font-mono gap-2 text-[#756B7D]">
          <span>Already have an account?</span>
          <Link
            to="/login"
            className="text-[#C084FC] hover:text-[#E9D5FF] font-medium tracking-wide underline underline-offset-4 decoration-[rgba(168,85,247,0.3)] hover:decoration-[#C084FC] transition-colors"
          >
            SIGN IN →
          </Link>
        </div>
      </AuthPanel>
    </AuthLayout>
  );
}
