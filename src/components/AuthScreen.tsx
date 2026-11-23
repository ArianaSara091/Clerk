import React, { useEffect, useRef, useState } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  User,
} from 'firebase/auth';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { sanitizeUsername } from '../lib/validation';
import {
  checkLoginGuard,
  checkUsernameAvailability,
  DiscordOAuthPopupError,
  evaluatePasswordStrength,
  openDiscordOAuthPopup,
  reportLoginFailure,
  reportLoginSuccess,
  requestEmailOtp,
  resolveLoginEmail,
  validateDateOfBirth,
  verifyEmailOtp,
} from '../services/authService';
import { ensureUserProfile } from '../services/guildspaceApi';
import { DiscordOAuthProfile } from '../types/guildspace';
import { BrandMark } from './BrandMark';

interface AuthScreenProps {
  twoFactorPendingUser: User | null;
  twoFactorEmail: string;
  onAuthCompleted: (options: {
    user: User;
    rememberMe: boolean;
    dateOfBirth?: string;
    preferredUsername?: string;
    otpVerified?: boolean;
    discordProfile?: DiscordOAuthProfile;
    importDiscordUsername?: boolean;
    importDiscordAvatar?: boolean;
  }) => Promise<void>;
  onCancelTwoFactor: () => Promise<void>;
}

type AuthView =
  | 'login'
  | 'signup'
  | 'forgot'
  | 'verify-signup'
  | 'verify-2fa'
  | 'discord-consent';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 105 }, (_, i) => String(CURRENT_YEAR - 13 - i));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

const DiscordGlyph: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({
  twoFactorPendingUser,
  twoFactorEmail,
  onAuthCompleted,
  onCancelTwoFactor,
}) => {
  const [view, setView] = useState<AuthView>(twoFactorPendingUser ? 'verify-2fa' : 'login');
  const [policyModal, setPolicyModal] = useState<'terms' | 'privacy' | null>(null);

  // Login State
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Signup State
  const [regEmail, setRegEmail] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<{
    checking: boolean;
    available: boolean | null;
    message: string;
  }>({ checking: false, available: null, message: '' });
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);

  // Forgot Password State
  const [resetEmail, setResetEmail] = useState('');

  // Discord OAuth2 State
  const [discordPending, setDiscordPending] = useState<DiscordOAuthProfile | null>(null);
  const [discordMode, setDiscordMode] = useState<'create' | 'link'>('create');
  const [importDiscordUsername, setImportDiscordUsername] = useState(true);
  const [importDiscordAvatar, setImportDiscordAvatar] = useState(true);
  const [discordSetupNotice, setDiscordSetupNotice] = useState<{
    message: string;
    redirectUri?: string;
  } | null>(null);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  // OTP Verification State
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [challengeId, setChallengeId] = useState('');
  const [otpTargetEmail, setOtpTargetEmail] = useState('');
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingSignupData, setPendingSignupData] = useState<{
    email: string;
    username: string;
    password: string;
    dateOfBirth: string;
    discordProfile?: DiscordOAuthProfile;
    importDiscordUsername?: boolean;
    importDiscordAvatar?: boolean;
  } | null>(null);

  // Global Feedback
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (twoFactorPendingUser) {
      setView('verify-2fa');
      setOtpTargetEmail(twoFactorEmail);
    }
  }, [twoFactorPendingUser, twoFactorEmail]);

  // Send 2FA challenge automatically when entering verify-2fa
  useEffect(() => {
    if (view !== 'verify-2fa' || !twoFactorEmail || challengeId) return;
    let active = true;
    (async () => {
      try {
        const res = await requestEmailOtp(twoFactorEmail, '2fa');
        if (!active) return;
        setChallengeId(res.challengeId);
        setResendCooldown(res.cooldownSeconds);
        setPreviewCode(res.delivery === 'preview' && res.previewCode ? res.previewCode : null);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not send 2FA code.');
      }
    })();
    return () => {
      active = false;
    };
  }, [view, twoFactorEmail, challengeId]);

  // Resend Cooldown Countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Live Debounced Username Availability Check
  useEffect(() => {
    if (view !== 'signup' && !(view === 'discord-consent' && discordMode === 'create')) return;
    const trimmed = regUsername.trim().toLowerCase();
    if (!trimmed) {
      setUsernameStatus({ checking: false, available: null, message: '' });
      return;
    }

    setUsernameStatus({ checking: true, available: null, message: 'Checking availability...' });
    let active = true;
    const timer = setTimeout(async () => {
      const res = await checkUsernameAvailability(trimmed);
      if (!active) return;
      setUsernameStatus({
        checking: false,
        available: res.available,
        message: res.available ? `@${res.normalized} is available` : res.error || 'Unavailable',
      });
    }, 320);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [regUsername, view, discordMode]);

  const strength = evaluatePasswordStrength(regPassword);
  const passwordsMatch =
    regConfirmPassword.length === 0 || regPassword === regConfirmPassword;

  const clearFeedback = () => {
    setError(null);
    setSuccessMsg(null);
    setDiscordSetupNotice(null);
  };

  const handleDiscordContinue = async () => {
    clearFeedback();
    setLoading(true);
    try {
      const result = await openDiscordOAuthPopup('login');
      const dProfile = result.discordProfile;
      setDiscordPending(dProfile);
      setImportDiscordUsername(true);
      setImportDiscordAvatar(true);
      setDiscordMode('create');
      if (dProfile.email) {
        setRegEmail(dProfile.email);
        setLoginIdentifier(dProfile.email);
      }
      setRegUsername(sanitizeUsername(dProfile.username || dProfile.globalName || 'member'));
      setView('discord-consent');
      setSuccessMsg(`Authorized Discord account @${dProfile.username}. Choose what to import and connect your Clerk account.`);
    } catch (err) {
      if (err instanceof DiscordOAuthPopupError && err.needsConfig) {
        setDiscordSetupNotice({
          message: err.message,
          redirectUri: err.redirectUri,
        });
      } else {
        setError(err instanceof Error ? err.message : 'Discord authorization failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async (withPendingDiscord = false) => {
    clearFeedback();
    setLoading(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const cred = await signInWithPopup(auth, googleProvider);
      await onAuthCompleted({
        user: cred.user,
        rememberMe,
        otpVerified: true,
        discordProfile: withPendingDiscord && discordPending ? discordPending : undefined,
        importDiscordUsername: withPendingDiscord ? importDiscordUsername : false,
        importDiscordAvatar: withPendingDiscord ? importDiscordAvatar : false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (message.includes('auth/popup-closed-by-user')) {
        setError('Sign-in popup was closed before completing.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent, withPendingDiscord = false) => {
    e.preventDefault();
    clearFeedback();
    const identifier = loginIdentifier.trim().toLowerCase();
    if (!identifier || !loginPassword) {
      setError('Enter your email or username and password.');
      return;
    }

    setLoading(true);
    try {
      await checkLoginGuard(identifier);
      const resolvedEmail = await resolveLoginEmail(identifier);
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);

      const cred = await signInWithEmailAndPassword(auth, resolvedEmail, loginPassword);
      await reportLoginSuccess(
        identifier,
        resolvedEmail,
        identifier.includes('@') ? '' : identifier
      );
      await onAuthCompleted({
        user: cred.user,
        rememberMe,
        otpVerified: cred.user.emailVerified,
        discordProfile: withPendingDiscord && discordPending ? discordPending : undefined,
        importDiscordUsername: withPendingDiscord ? importDiscordUsername : false,
        importDiscordAvatar: withPendingDiscord ? importDiscordAvatar : false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      if (
        msg.includes('auth/invalid-credential') ||
        msg.includes('auth/wrong-password') ||
        msg.includes('auth/user-not-found')
      ) {
        const failRes = await reportLoginFailure(identifier).catch(() => ({
          attemptsRemaining: 4,
          locked: false,
          retryAfterSeconds: 0,
        }));
        if (failRes.locked) {
          setError(
            `Too many failed attempts. Account sign-in temporarily locked for ${Math.ceil(
              failRes.retryAfterSeconds / 60
            )} minute(s).`
          );
        } else {
          setError(
            `Invalid credentials. ${failRes.attemptsRemaining} attempt${
              failRes.attemptsRemaining === 1 ? '' : 's'
            } remaining before temporary lockout.`
          );
        }
      } else if (msg.includes('auth/operation-not-allowed')) {
        setError(
          'Email/Password sign-in is disabled in Firebase Console. Enable it under Authentication -> Sign-in method, or use Continue with Google.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignupStepOne = async (e: React.FormEvent, withPendingDiscord = false) => {
    e.preventDefault();
    clearFeedback();

    const cleanEmail = regEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    const userCheck = await checkUsernameAvailability(regUsername);
    if (!userCheck.available) {
      setError(userCheck.error || 'Please choose a valid, available username.');
      return;
    }

    if (strength.score < 2) {
      setError('Please choose a stronger password (at least 8 characters with mixed letters and numbers).');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const dobCheck = validateDateOfBirth(dobDay, dobMonth, dobYear);
    if (!dobCheck.valid) {
      setError(dobCheck.error || 'Please enter a valid date of birth.');
      return;
    }

    if (!acceptedPolicies) {
      setError('You must accept the Terms of Service and Privacy Policy to continue.');
      return;
    }

    setLoading(true);
    try {
      const otpRes = await requestEmailOtp(cleanEmail, 'signup');
      setPendingSignupData({
        email: cleanEmail,
        username: userCheck.normalized,
        password: regPassword,
        dateOfBirth: dobCheck.iso,
        discordProfile: withPendingDiscord && discordPending ? discordPending : undefined,
        importDiscordUsername: withPendingDiscord ? importDiscordUsername : false,
        importDiscordAvatar: withPendingDiscord ? importDiscordAvatar : false,
      });
      setChallengeId(otpRes.challengeId);
      setOtpTargetEmail(cleanEmail);
      setOtpDigits(['', '', '', '', '', '']);
      setResendCooldown(otpRes.cooldownSeconds);
      setPreviewCode(otpRes.delivery === 'preview' && otpRes.previewCode ? otpRes.previewCode : null);
      setView('verify-signup');
      setSuccessMsg(`A 6-digit security code was sent to ${cleanEmail}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start verification.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpDigitChange = (index: number, value: string) => {
    const digitsOnly = value.replace(/\D/g, '');
    if (!digitsOnly) {
      const next = [...otpDigits];
      next[index] = '';
      setOtpDigits(next);
      return;
    }

    if (digitsOnly.length > 1) {
      const next = [...otpDigits];
      for (let i = 0; i < 6 && i + index < 6; i++) {
        next[index + i] = digitsOnly[i];
      }
      setOtpDigits(next);
      const focusIdx = Math.min(5, index + digitsOnly.length);
      otpInputRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...otpDigits];
    next[index] = digitsOnly;
    setOtpDigits(next);
    if (index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || !otpTargetEmail) return;
    clearFeedback();
    setLoading(true);
    try {
      const purpose = view === 'verify-2fa' ? '2fa' : 'signup';
      const res = await requestEmailOtp(otpTargetEmail, purpose);
      setChallengeId(res.challengeId);
      setResendCooldown(res.cooldownSeconds);
      setOtpDigits(['', '', '', '', '', '']);
      setPreviewCode(res.delivery === 'preview' && res.previewCode ? res.previewCode : null);
      setSuccessMsg('A fresh 6-digit verification code has been issued.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Enter all 6 digits of your verification code.');
      return;
    }

    setLoading(true);
    try {
      await verifyEmailOtp(challengeId, otpTargetEmail, code);

      if (view === 'verify-signup' && pendingSignupData) {
        await setPersistence(auth, browserLocalPersistence);
        const cred = await createUserWithEmailAndPassword(
          auth,
          pendingSignupData.email,
          pendingSignupData.password
        );
        const displayName =
          pendingSignupData.discordProfile && pendingSignupData.importDiscordUsername
            ? pendingSignupData.discordProfile.globalName || pendingSignupData.username
            : pendingSignupData.username;
        await updateProfile(cred.user, {
          displayName,
          photoURL:
            pendingSignupData.discordProfile && pendingSignupData.importDiscordAvatar
              ? pendingSignupData.discordProfile.avatarUrl
              : undefined,
        });
        void sendEmailVerification(cred.user).catch(() => {});

        await ensureUserProfile(cred.user, {
          preferredDisplayName: displayName,
          preferredUsername: pendingSignupData.username,
          dateOfBirth: pendingSignupData.dateOfBirth,
          isVerified: true,
          discordProfile: pendingSignupData.discordProfile,
          importDiscordUsername: pendingSignupData.importDiscordUsername,
          importDiscordAvatar: pendingSignupData.importDiscordAvatar,
        });

        await reportLoginSuccess(
          pendingSignupData.email,
          pendingSignupData.email,
          pendingSignupData.username
        );

        await onAuthCompleted({
          user: cred.user,
          rememberMe: true,
          dateOfBirth: pendingSignupData.dateOfBirth,
          preferredUsername: pendingSignupData.username,
          otpVerified: true,
          discordProfile: pendingSignupData.discordProfile,
          importDiscordUsername: pendingSignupData.importDiscordUsername,
          importDiscordAvatar: pendingSignupData.importDiscordAvatar,
        });
      } else if (view === 'verify-2fa' && twoFactorPendingUser) {
        await onAuthCompleted({
          user: twoFactorPendingUser,
          rememberMe,
          otpVerified: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed.';
      if (msg.includes('auth/email-already-in-use')) {
        setError('An account with this email already exists. Please sign in to link your account.');
      } else if (msg.includes('auth/operation-not-allowed')) {
        setError(
          'Email/Password registration is disabled in Firebase Console. Enable it under Authentication -> Sign-in method, or use Continue with Google.'
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    const target = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('Enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, target);
      setSuccessMsg(`Password reset instructions sent to ${target}. Check your inbox.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send password reset email.';
      if (msg.includes('auth/user-not-found')) {
        setSuccessMsg(`If an account exists for ${target}, a password reset link has been sent.`);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const strengthColors = [
    'bg-slate-700',
    'bg-rose-500',
    'bg-amber-500',
    'bg-blue-500',
    'bg-emerald-500',
  ];

  const renderDiscordSetupNotice = () =>
    discordSetupNotice && (
      <div className="p-3.5 rounded-xl bg-[#5865F2]/10 border border-[#5865F2]/35 space-y-2 text-xs">
        <div className="font-semibold text-indigo-200 flex items-center gap-2">
          <DiscordGlyph className="w-4 h-4 text-[#8B97FF]" />
          <span>Discord OAuth2 Setup Required</span>
        </div>
        <p className="text-slate-300 leading-relaxed">{discordSetupNotice.message}</p>
        {discordSetupNotice.redirectUri && (
          <div className="space-y-1">
            <div className="text-[11px] text-slate-400">Discord Developer Portal Redirect URI:</div>
            <div className="flex items-center gap-2 bg-[#090B11] border border-white/10 rounded-lg px-2.5 py-1.5">
              <code className="text-[11px] text-indigo-300 truncate flex-1 font-mono">
                {discordSetupNotice.redirectUri}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(discordSetupNotice.redirectUri || '');
                  setCopiedRedirect(true);
                  setTimeout(() => setCopiedRedirect(false), 1800);
                }}
                className="text-[11px] font-semibold text-slate-200 hover:text-white inline-flex items-center gap-1 shrink-0"
              >
                {copiedRedirect ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedRedirect ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>
    );

  return (
    <div className="min-h-screen w-full overflow-y-auto bg-[#080A10] text-slate-100 flex items-center justify-center p-4 sm:p-6 relative">
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(760px circle at 15% 15%, rgba(124, 58, 237, 0.22), transparent 55%), radial-gradient(680px circle at 85% 85%, rgba(37, 99, 235, 0.18), transparent 55%)',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={`relative z-10 w-full ${
          view === 'signup' || view === 'discord-consent' ? 'max-w-[540px]' : 'max-w-[460px]'
        } bg-[#111420]/95 backdrop-blur-xl border border-white/[0.09] rounded-2xl shadow-2xl overflow-hidden my-4`}
      >
        <div className="h-1 w-full bg-gradient-to-r from-violet-600 via-indigo-500 to-blue-500" />

        <div className="p-6 sm:p-8">
          {/* Brand Lockup */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-2.5">
              <BrandMark size={30} />
              <span className="text-lg font-bold font-display tracking-tight text-white">
                Clerk
              </span>
            </div>
            {(view === 'forgot' ||
              view === 'verify-signup' ||
              view === 'verify-2fa' ||
              view === 'discord-consent') && (
              <button
                type="button"
                onClick={async () => {
                  clearFeedback();
                  if (view === 'verify-2fa') {
                    await onCancelTwoFactor();
                  }
                  if (view === 'discord-consent') {
                    setDiscordPending(null);
                  }
                  setChallengeId('');
                  setPreviewCode(null);
                  setView(view === 'verify-signup' ? 'signup' : 'login');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>

          <AnimatePresence mode="wait">
            {view === 'login' && (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.16 }}
                className="space-y-5"
              >
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold font-display text-white tracking-tight">
                    Welcome back
                  </h1>
                  <p className="text-sm text-slate-400">
                    Sign in to Clerk servers, voice rooms, and direct messages.
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-xl px-3.5 py-3 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="flex items-start gap-2.5 text-xs text-emerald-200 bg-emerald-500/12 border border-emerald-500/30 rounded-xl px-3.5 py-3 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {renderDiscordSetupNotice()}

                <form onSubmit={(e) => void handleLoginSubmit(e, false)} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="login-id" className="block text-xs font-semibold text-slate-300">
                      Email Address or Username
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="login-id"
                        type="text"
                        required
                        autoComplete="username"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        placeholder="you@domain.com or username"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="login-pw" className="block text-xs font-semibold text-slate-300">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          clearFeedback();
                          setResetEmail(loginIdentifier.includes('@') ? loginIdentifier : '');
                          setView('forgot');
                        }}
                        className="text-xs font-medium text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="login-pw"
                        type={showLoginPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="w-full pl-10 pr-11 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword((prev) => !prev)}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white transition-colors"
                      >
                        {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded accent-violet-600"
                    />
                    <span className="text-xs text-slate-300">Remember me on this device</span>
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-60"
                  >
                    <span>{loading ? 'Signing in...' : 'Log In'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-white/[0.08]" />
                  <span className="shrink-0 mx-3 text-xs text-slate-500">or continue with</span>
                  <div className="flex-grow border-t border-white/[0.08]" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleDiscordContinue()}
                    disabled={loading}
                    className="flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-sm transition-colors disabled:opacity-60"
                  >
                    <DiscordGlyph className="w-4 h-4 shrink-0" />
                    <span>Continue with Discord</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleGoogleSignIn(false)}
                    disabled={loading}
                    className="flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm transition-colors disabled:opacity-60"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                      />
                    </svg>
                    <span>Google</span>
                  </button>
                </div>

                <p className="text-center text-xs text-slate-400 pt-1">
                  Need a Clerk account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setView('signup');
                    }}
                    className="font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Create an Account
                  </button>
                </p>
              </motion.div>
            )}

            {view === 'signup' && (
              <motion.div
                key="signup"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold font-display text-white tracking-tight">
                    Create a Clerk account
                  </h1>
                  <p className="text-sm text-slate-400">
                    Independent Clerk identity with email verification or optional Discord OAuth2 linking.
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-xl px-3.5 py-3 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {renderDiscordSetupNotice()}

                <button
                  type="button"
                  onClick={() => void handleDiscordContinue()}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-sm transition-colors disabled:opacity-60"
                >
                  <DiscordGlyph className="w-4 h-4 shrink-0" />
                  <span>Continue with Discord</span>
                </button>

                <div className="relative flex items-center">
                  <div className="flex-grow border-t border-white/[0.08]" />
                  <span className="shrink-0 mx-3 text-xs text-slate-500">or register natively</span>
                  <div className="flex-grow border-t border-white/[0.08]" />
                </div>

                <form onSubmit={(e) => void handleSignupStepOne(e, false)} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-300">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="reg-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="alex@domain.com"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="reg-username" className="block text-xs font-semibold text-slate-300">
                        Username
                      </label>
                      {usernameStatus.message && (
                        <span
                          className={`text-[11px] font-medium ${
                            usernameStatus.checking
                              ? 'text-slate-400'
                              : usernameStatus.available
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {usernameStatus.message}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="reg-username"
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        autoComplete="username"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
                        placeholder="alex_mercer"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="reg-pw" className="block text-xs font-semibold text-slate-300">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="reg-pw"
                          type={showRegPassword ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Create password"
                          className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword((p) => !p)}
                          aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                        >
                          {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="reg-pw-confirm" className="block text-xs font-semibold text-slate-300">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <input
                          id="reg-pw-confirm"
                          type={showRegConfirm ? 'text' : 'password'}
                          required
                          autoComplete="new-password"
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder="Repeat password"
                          className={`w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#090B11] border text-sm text-white placeholder:text-slate-500 focus:outline-none ${
                            passwordsMatch
                              ? 'border-white/10 focus:border-violet-500'
                              : 'border-rose-500/60 focus:border-rose-500'
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegConfirm((p) => !p)}
                          aria-label={showRegConfirm ? 'Hide confirmation' : 'Show confirmation'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                        >
                          {showRegConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {regPassword.length > 0 && (
                    <div className="space-y-2 p-3 rounded-xl bg-[#090B11] border border-white/[0.06]">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Password strength</span>
                        <span
                          className={`font-semibold ${
                            strength.score >= 4
                              ? 'text-emerald-400'
                              : strength.score === 3
                              ? 'text-blue-400'
                              : strength.score === 2
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {strength.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map((bar) => (
                          <div
                            key={bar}
                            className={`h-1.5 rounded-full transition-colors ${
                              strength.score >= bar ? strengthColors[strength.score] : 'bg-white/10'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400 pt-0.5">
                        <span className={strength.checks.length ? 'text-emerald-400' : ''}>
                          {strength.checks.length ? '✓' : '·'} 8+ characters
                        </span>
                        <span
                          className={
                            strength.checks.upper && strength.checks.lower ? 'text-emerald-400' : ''
                          }
                        >
                          {strength.checks.upper && strength.checks.lower ? '✓' : '·'} Upper &amp; lowercase
                        </span>
                        <span className={strength.checks.number ? 'text-emerald-400' : ''}>
                          {strength.checks.number ? '✓' : '·'} At least one number
                        </span>
                        <span className={strength.checks.symbol ? 'text-emerald-400' : ''}>
                          {strength.checks.symbol ? '✓' : '·'} Special symbol
                        </span>
                      </div>
                    </div>
                  )}

                  {!passwordsMatch && (
                    <p className="text-xs text-rose-400">Passwords do not match.</p>
                  )}

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300">Date of Birth</label>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        aria-label="Birth month"
                        required
                        value={dobMonth}
                        onChange={(e) => setDobMonth(e.target.value)}
                        className="px-3 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                      >
                        <option value="">Month</option>
                        {MONTHS.map((m, idx) => (
                          <option key={m} value={String(idx + 1)}>
                            {m}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Birth day"
                        required
                        value={dobDay}
                        onChange={(e) => setDobDay(e.target.value)}
                        className="px-3 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                      >
                        <option value="">Day</option>
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Birth year"
                        required
                        value={dobYear}
                        onChange={(e) => setDobYear(e.target.value)}
                        className="px-3 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                      >
                        <option value="">Year</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={acceptedPolicies}
                      onChange={(e) => setAcceptedPolicies(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded accent-violet-600 shrink-0"
                    />
                    <span className="text-xs text-slate-400 leading-relaxed">
                      I have read and agree to Clerk&apos;s{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setPolicyModal('terms');
                        }}
                        className="text-violet-400 hover:text-violet-300 underline"
                      >
                        Terms of Service
                      </button>{' '}
                      and{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setPolicyModal('privacy');
                        }}
                        className="text-violet-400 hover:text-violet-300 underline"
                      >
                        Privacy Policy
                      </button>
                      .
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-60"
                  >
                    <span>{loading ? 'Sending Verification Code...' : 'Continue'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>

                <p className="text-center text-xs text-slate-400 pt-1">
                  Already have a Clerk account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setView('login');
                    }}
                    className="font-semibold text-violet-400 hover:text-violet-300 transition-colors"
                  >
                    Sign In
                  </button>
                </p>
              </motion.div>
            )}

            {view === 'discord-consent' && discordPending && (
              <motion.div
                key="discord-consent"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-300">
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Discord OAuth2 Identity Verified</span>
                  </div>
                  <h1 className="text-xl font-bold font-display text-white">
                    Connect Discord to Clerk
                  </h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Clerk uses its own independent accounts and servers. Choose what to import from your authorized Discord account.
                  </p>
                </div>

                {/* Authorized Discord Card + Explicit Consent Checkboxes */}
                <div className="p-4 rounded-xl bg-[#090B11] border border-[#5865F2]/35 space-y-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={discordPending.avatarUrl}
                      alt={discordPending.username}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-full object-cover border border-white/15 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-white truncate">
                        {discordPending.globalName || discordPending.username}
                      </div>
                      <div className="text-xs font-mono text-indigo-300 truncate">
                        @{discordPending.username} · Discord ID {discordPending.id}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-white/[0.06] text-xs">
                    <label className="flex items-center gap-2.5 cursor-pointer text-slate-200">
                      <input
                        type="checkbox"
                        checked={importDiscordUsername}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setImportDiscordUsername(checked);
                          if (checked) {
                            setRegUsername(sanitizeUsername(discordPending.username));
                          }
                        }}
                        className="w-4 h-4 rounded accent-[#5865F2]"
                      />
                      <span>Import Discord username &amp; display name with consent</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer text-slate-200">
                      <input
                        type="checkbox"
                        checked={importDiscordAvatar}
                        onChange={(e) => setImportDiscordAvatar(e.target.checked)}
                        className="w-4 h-4 rounded accent-[#5865F2]"
                      />
                      <span>Import Discord profile avatar with consent</span>
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-xl px-3.5 py-3 leading-relaxed">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#090B11] border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setDiscordMode('create');
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      discordMode === 'create'
                        ? 'bg-violet-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    New Clerk Account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearFeedback();
                      setDiscordMode('link');
                    }}
                    className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                      discordMode === 'link'
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Link Existing Account
                  </button>
                </div>

                {discordMode === 'create' ? (
                  <form onSubmit={(e) => void handleSignupStepOne(e, true)} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-300">Email Address</label>
                        <input
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="you@domain.com"
                          className="w-full px-3 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <label className="block text-xs font-semibold text-slate-300">Username</label>
                          {usernameStatus.message && (
                            <span
                              className={`text-[10px] truncate ${
                                usernameStatus.available ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {usernameStatus.available ? 'Available' : 'Unavailable'}
                            </span>
                          )}
                        </div>
                        <input
                          type="text"
                          required
                          minLength={3}
                          maxLength={32}
                          value={regUsername}
                          onChange={(e) => setRegUsername(e.target.value.toLowerCase())}
                          className="w-full px-3 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-violet-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        type="password"
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Create Clerk password"
                        className="w-full px-3 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                      <input
                        type="password"
                        required
                        value={regConfirmPassword}
                        onChange={(e) => setRegConfirmPassword(e.target.value)}
                        placeholder="Confirm password"
                        className="w-full px-3 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white focus:outline-none focus:border-violet-500"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <select
                        required
                        value={dobMonth}
                        onChange={(e) => setDobMonth(e.target.value)}
                        className="px-2.5 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white"
                      >
                        <option value="">Month</option>
                        {MONTHS.map((m, idx) => (
                          <option key={m} value={String(idx + 1)}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <select
                        required
                        value={dobDay}
                        onChange={(e) => setDobDay(e.target.value)}
                        className="px-2.5 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white"
                      >
                        <option value="">Day</option>
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        required
                        value={dobYear}
                        onChange={(e) => setDobYear(e.target.value)}
                        className="px-2.5 py-2 rounded-xl bg-[#090B11] border border-white/10 text-xs text-white"
                      >
                        <option value="">Year</option>
                        {YEARS.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-400">
                      <input
                        type="checkbox"
                        checked={acceptedPolicies}
                        onChange={(e) => setAcceptedPolicies(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded accent-violet-600 shrink-0"
                      />
                      <span>I accept Clerk&apos;s Terms of Service and Privacy Policy.</span>
                    </label>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {loading ? 'Sending Verification Code...' : 'Verify Email & Create Linked Account'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleLoginSubmit(e, true)} className="space-y-3">
                    <input
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="Clerk email or username"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Clerk password"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {loading ? 'Signing in...' : 'Sign In & Link Discord'}
                    </button>
                  </form>
                )}

                <div className="pt-1">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleGoogleSignIn(true)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs transition-colors disabled:opacity-60"
                  >
                    <span>Or Continue with Google &amp; Link Discord</span>
                  </button>
                </div>
              </motion.div>
            )}

            {(view === 'verify-signup' || view === 'verify-2fa') && (
              <motion.div
                key="verify-otp"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600/25 to-blue-600/25 border border-violet-500/35 flex items-center justify-center text-violet-300 mb-3">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <h1 className="text-xl font-bold font-display text-white">
                    {view === 'verify-2fa'
                      ? 'Two-Factor Security Check'
                      : 'Verify your email address'}
                  </h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Enter the 6-digit security verification code sent to{' '}
                    <span className="text-slate-200 font-medium">{otpTargetEmail}</span>. Codes expire in 10 minutes.
                  </p>
                </div>

                {previewCode && (
                  <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold text-blue-300">
                      <span>Preview Verification Inbox</span>
                      <span className="font-mono text-base tracking-widest text-white bg-black/30 px-2.5 py-0.5 rounded-lg">
                        {previewCode}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      SMTP is not configured in this environment. Configure SMTP secrets for live inbox delivery.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="flex items-start gap-2.5 text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-xl px-3.5 py-3">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="flex items-start gap-2.5 text-xs text-emerald-200 bg-emerald-500/12 border border-emerald-500/30 rounded-xl px-3.5 py-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <form onSubmit={handleVerifyOtpSubmit} className="space-y-5">
                  <div className="grid grid-cols-6 gap-2">
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          otpInputRefs.current[idx] = el;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        aria-label={`Verification digit ${idx + 1}`}
                        value={digit}
                        onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        className="h-12 text-center font-mono text-lg font-bold rounded-xl bg-[#090B11] border border-white/15 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                      />
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-60"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {loading
                        ? 'Verifying...'
                        : view === 'verify-2fa'
                        ? 'Verify & Sign In'
                        : 'Verify & Activate Account'}
                    </span>
                  </button>
                </form>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400">Didn&apos;t receive a code?</span>
                  <button
                    type="button"
                    disabled={resendCooldown > 0 || loading}
                    onClick={handleResendOtp}
                    className="inline-flex items-center gap-1.5 font-semibold text-violet-400 hover:text-violet-300 disabled:text-slate-500 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Code'}
                  </button>
                </div>
              </motion.div>
            )}

            {view === 'forgot' && (
              <motion.div
                key="forgot"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="space-y-5"
              >
                <div className="space-y-1.5">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600/25 to-blue-600/25 border border-violet-500/35 flex items-center justify-center text-blue-300 mb-3">
                    <KeyRound className="w-5 h-5" />
                  </div>
                  <h1 className="text-xl font-bold font-display text-white">Reset your password</h1>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Enter your Clerk account email and Firebase will send a secure password reset link.
                  </p>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 text-xs text-rose-200 bg-rose-500/12 border border-rose-500/30 rounded-xl px-3.5 py-3">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {successMsg && (
                  <div className="flex items-start gap-2.5 text-xs text-emerald-200 bg-emerald-500/12 border border-emerald-500/30 rounded-xl px-3.5 py-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-300">
                      Email Address
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="you@domain.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#090B11] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white text-sm font-semibold transition-all disabled:opacity-60"
                  >
                    {loading ? 'Sending Reset Link...' : 'Send Password Reset Email'}
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Inline Terms / Privacy Policy Dialog */}
      {policyModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#131622] border border-white/10 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold font-display text-white">
              {policyModal === 'terms' ? 'Clerk Terms of Service' : 'Clerk Privacy Policy'}
            </h2>
            <div className="text-xs text-slate-300 leading-relaxed space-y-2.5 max-h-64 overflow-y-auto gs-scroll">
              {policyModal === 'terms' ? (
                <>
                  <p>
                    1. <strong>Community Conduct:</strong> Respect community guidelines, server rules, and fellow members across text and voice channels.
                  </p>
                  <p>
                    2. <strong>Account Security:</strong> Keep your credentials and 6-digit security verification codes private. Clerk never asks for your Discord password.
                  </p>
                  <p>
                    3. <strong>Age Requirement:</strong> You confirm that you meet the minimum age requirement of 13 years or older.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    1. <strong>Isolated Private Data:</strong> Your email address, Discord email, and date of birth are stored in owner-only private records and never exposed publicly.
                  </p>
                  <p>
                    2. <strong>Optional Discord OAuth2:</strong> Linking Discord only retrieves your authorized Discord profile with your explicit consent for username or avatar import. You may unlink at any time.
                  </p>
                  <p>
                    3. <strong>Session Control:</strong> You can inspect active devices, revoke sessions, or toggle two-factor authentication anytime in Settings.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPolicyModal(null)}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
