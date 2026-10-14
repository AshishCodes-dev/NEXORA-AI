import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { springs } from '../../motion/transitions';

const GIS_SCRIPT_ID = 'google-gis-sdk';

/**
 * Lazily injects and loads Google Identity Services (GIS) client script.
 * @returns {Promise<any>}
 */
function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve(null);
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);

    const existingScript = document.getElementById(GIS_SCRIPT_ID);
    if (existingScript) {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
      existingScript.addEventListener('load', () => resolve(window.google?.accounts?.id));
      existingScript.addEventListener('error', (e) => reject(e));
      return;
    }

    const script = document.createElement('script');
    script.id = GIS_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google?.accounts?.id);
    script.onerror = () => reject(new Error('Failed to load Google Identity Services SDK'));
    document.body.appendChild(script);
  });
}

/**
 * GoogleAuthButton
 * Secure Google Identity Services integration styled for NEXORA's electric-violet OS console.
 * Defaults to disabled = true state with (COMING SOON) label when unconfigured.
 * Automatically enables when VITE_GOOGLE_CLIENT_ID is configured and loaded.
 */
export default function GoogleAuthButton(props) {
  const {
    onClick,
    onSuccess,
    onError,
    disabled: callerDisabled,
    text = 'CONTINUE WITH GOOGLE',
    className = '',
    clientId,
  } = props;

  // Enforces disabled = true default when unconfigured
  const prefersReducedMotion = useReducedMotion();
  const hiddenButtonRef = useRef(null);
  const [gisLoaded, setGisLoaded] = useState(false);

  const resolvedClientId =
    clientId ||
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID
      ? import.meta.env.VITE_GOOGLE_CLIENT_ID.trim()
      : '');

  const isConfigured = Boolean(resolvedClientId);
  const disabled = !isConfigured || (callerDisabled ?? true);
  const displayText = !isConfigured ? 'CONTINUE WITH GOOGLE (COMING SOON)' : text;

  useEffect(() => {
    if (!isConfigured) return;
    let mounted = true;

    loadGsiScript()
      .then((googleId) => {
        if (!mounted || !googleId) return;
        try {
          googleId.initialize({
            client_id: resolvedClientId,
            callback: (response) => {
              if (response && response.credential) {
                if (onSuccess) onSuccess(response.credential);
              } else if (onError) {
                onError(new Error('Google sign-in completed without credential'));
              }
            },
          });

          if (hiddenButtonRef.current) {
            googleId.renderButton(hiddenButtonRef.current, {
              type: 'standard',
              theme: 'outline',
              size: 'large',
            });
          }
          setGisLoaded(true);
        } catch (initErr) {
          console.warn('[NEXORA AUTH] Failed to initialize Google Identity Services:', initErr);
          if (onError) onError(initErr);
        }
      })
      .catch((err) => {
        console.warn('[NEXORA AUTH] Google GIS script load error:', err);
        if (onError) onError(err);
      });

    return () => {
      mounted = false;
    };
  }, [isConfigured, resolvedClientId, onSuccess, onError]);

  const handleClick = (e) => {
    e.preventDefault();
    if (disabled) return;

    if (onClick) {
      onClick(e);
      return;
    }

    if (isConfigured && window.google?.accounts?.id) {
      try {
        window.google.accounts.id.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            if (hiddenButtonRef.current) {
              const gisInternalBtn = hiddenButtonRef.current.querySelector('div[role="button"]');
              if (gisInternalBtn) gisInternalBtn.click();
            }
          }
        });
      } catch (promptErr) {
        if (onError) onError(promptErr);
      }
    }
  };

  return (
    <>
      {isConfigured && (
        <div ref={hiddenButtonRef} className="hidden pointer-events-none" aria-hidden="true" />
      )}
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-disabled={disabled}
        title={
          !isConfigured
            ? 'Google authentication is scheduled for an upcoming release. Please sign in with email and password.'
            : undefined
        }
        whileHover={disabled || prefersReducedMotion ? {} : { scale: 1.012 }}
        whileTap={disabled || prefersReducedMotion ? {} : { scale: 0.988 }}
        transition={springs.tactile}
        className={`w-full relative flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-[#090710] border border-[rgba(168,85,247,0.18)] text-xs sm:text-sm font-mono font-medium text-[#A8A29E] shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-colors duration-200 min-h-[42px] ${
          disabled
            ? 'opacity-60 cursor-not-allowed border-[rgba(168,85,247,0.1)] hover:bg-[#090710] hover:text-[#A8A29E]'
            : 'cursor-pointer hover:bg-[#0E0D14] hover:border-[rgba(192,132,252,0.45)] hover:text-[#F5F1FA]'
        } ${className}`}
      >
        {/* Official Google G Logo SVG */}
        <svg className="w-4 h-4 shrink-0 opacity-75" viewBox="0 0 24 24" aria-hidden="true">
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

        <span className="tracking-wider">{displayText}</span>
      </motion.button>
    </>
  );
}
