import type { ReactNode } from 'react';
import { Check, AlertTriangle, Loader2, Info, ArrowRight, ShieldCheck } from 'lucide-react';

export type CheckStatus = 'idle' | 'checking' | 'ok' | 'failed' | 'not-required';

export interface SystemCheckTile {
  tileKey: string;
  icon: ReactNode;
  label: string;
  status: CheckStatus;
  okLabel: string;
  failLabel: string;
  okDescription: string;
  failDescription: string;
  preview?: ReactNode;
}

interface CameraDiagnosticsSummary {
  devicesFound: number;
  deviceLabels: string[];
  framesVerified: boolean;
}

interface SystemCheckCardProps {
  tiles: SystemCheckTile[];
  allChecksOk: boolean;
  deviceCheckNeeded: boolean;
  checkingDevices: boolean;
  hasRunOnce: boolean;
  onRunCheck: () => void;
  onNext: () => void;
  cameraDiagnostics?: CameraDiagnosticsSummary | null;
  showCameraDiagnostics: boolean;
}

/**
 * Shared presentational card for the pre-exam device readiness check, used by
 * both NormalBrowserSystemCheck and SebSystemCheck (which only differ in the
 * page header). Keeping this in one place avoids duplicating the status-card
 * grid, badge, and footer logic across both near-identical flows.
 */
export default function SystemCheckCard({
  tiles,
  allChecksOk,
  deviceCheckNeeded,
  checkingDevices,
  hasRunOnce,
  onRunCheck,
  onNext,
  cameraDiagnostics,
  showCameraDiagnostics,
}: SystemCheckCardProps) {
  const hasFailure = hasRunOnce && !checkingDevices && !allChecksOk && deviceCheckNeeded;

  return (
    <div className="w-full max-w-[1180px] mx-auto bg-white rounded-3xl shadow-[0_8px_40px_-12px_rgba(15,23,42,0.15)] overflow-hidden">
      <div
        className="px-6 sm:px-10 pt-8 sm:pt-10 pb-6 sm:pb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 border-b"
        style={{ borderColor: 'var(--admin-border-soft)' }}
      >
        <div className="flex items-start sm:items-center gap-4">
          <div
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: '#E7F8EE', color: '#16A34A' }}
          >
            <ShieldCheck className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--admin-text)' }}>
              System Check
            </h1>
            <p className="mt-1 text-sm sm:text-[15px] max-w-md" style={{ color: 'var(--admin-text-muted)' }}>
              We&apos;ll check your device, permissions and connection to make sure everything is ready for your
              assessment.
            </p>
          </div>
        </div>
        <OverallStatusBadge
          checkingDevices={checkingDevices}
          hasRunOnce={hasRunOnce}
          allChecksOk={allChecksOk}
          deviceCheckNeeded={deviceCheckNeeded}
        />
      </div>

      <div className="px-6 sm:px-10 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {tiles.map((tile) => (
            <CheckStatusCard key={tile.tileKey} {...tile} />
          ))}
        </div>

        {showCameraDiagnostics && cameraDiagnostics && (
          <div
            className="mt-5 text-left w-full rounded-xl px-4 py-3"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', fontSize: '12px', lineHeight: 1.6, color: '#991B1B' }}
          >
            <p className="font-semibold mb-1">Camera diagnostics</p>
            <div>Devices found: {cameraDiagnostics.devicesFound}</div>
            <div>Device labels: {cameraDiagnostics.deviceLabels.join(', ') || '(none)'}</div>
            <div>Frames verified: {String(cameraDiagnostics.framesVerified)}</div>
          </div>
        )}
      </div>

      <div className="px-6 sm:px-10 pb-8 sm:pb-10">
        <div
          className="rounded-2xl px-5 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 sm:justify-between transition-colors duration-300"
          style={{
            background: hasFailure ? '#FEF2F2' : '#EEF4FF',
            border: `1px solid ${hasFailure ? '#FECACA' : '#DCE6FB'}`,
          }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: hasFailure ? '#FEE2E2' : '#DCE6FB', color: hasFailure ? '#DC2626' : '#1F3556' }}
            >
              {hasFailure ? <AlertTriangle className="w-4 h-4" /> : <Info className="w-4 h-4" />}
            </div>
            <div>
              <p className="text-sm sm:text-[15px] font-semibold" style={{ color: 'var(--admin-text)' }}>
                {!deviceCheckNeeded
                  ? 'No device checks required'
                  : hasFailure
                    ? 'Action required'
                    : allChecksOk
                      ? 'Everything looks good!'
                      : 'Ready when you are'}
              </p>
              <p className="text-xs sm:text-sm mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>
                {!deviceCheckNeeded
                  ? 'No device checks are required for this assessment.'
                  : hasFailure
                    ? 'Please resolve the issues above before continuing.'
                    : 'Camera and microphone permissions stay active for the whole assessment.'}
              </p>
            </div>
          </div>

          <div className="flex-shrink-0 w-full sm:w-auto">
            {!allChecksOk ? (
              <button
                type="button"
                onClick={onRunCheck}
                disabled={checkingDevices || !deviceCheckNeeded}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background: 'var(--admin-accent)', color: 'white' }}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--admin-accent-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--admin-accent)';
                }}
              >
                {checkingDevices && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {checkingDevices ? 'Checking…' : hasRunOnce ? 'Retry system check' : 'Run system check'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onNext}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background: 'var(--admin-accent)', color: 'white' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--admin-accent-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--admin-accent)';
                }}
              >
                Next
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverallStatusBadge({
  checkingDevices,
  hasRunOnce,
  allChecksOk,
  deviceCheckNeeded,
}: {
  checkingDevices: boolean;
  hasRunOnce: boolean;
  allChecksOk: boolean;
  deviceCheckNeeded: boolean;
}) {
  let label = 'Ready to check';
  let bg = '#F1F5F9';
  let fg = '#475569';
  let icon: ReactNode = null;

  if (!deviceCheckNeeded) {
    label = 'No checks required';
  } else if (checkingDevices) {
    label = 'Checking systems…';
    bg = '#DBEAFE';
    fg = '#1D4ED8';
    icon = <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />;
  } else if (allChecksOk) {
    label = 'All systems ready';
    bg = '#DCFCE7';
    fg = '#15803D';
    icon = <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden="true" />;
  } else if (hasRunOnce) {
    label = 'Action required';
    bg = '#FEE2E2';
    fg = '#DC2626';
    icon = <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />;
  }

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-300"
      style={{ background: bg, color: fg }}
    >
      {icon}
      {label}
    </span>
  );
}

function CheckStatusCard({ icon, label, status, okLabel, failLabel, okDescription, failDescription, preview }: SystemCheckTile) {
  const isOk = status === 'ok' || status === 'not-required';
  const isFailed = status === 'failed';
  const isChecking = status === 'checking';

  const badgeText =
    status === 'idle' ? 'Pending' : status === 'checking' ? 'Checking…' : status === 'not-required' ? 'Not required' : isFailed ? failLabel : okLabel;
  const description =
    status === 'idle'
      ? 'Waiting to run the system check.'
      : status === 'checking'
        ? 'Checking…'
        : status === 'not-required'
          ? 'Not required for this assessment.'
          : isFailed
            ? failDescription
            : okDescription;

  const borderColor = isOk ? '#BBF7D0' : isFailed ? '#FECACA' : isChecking ? '#BFDBFE' : 'var(--admin-border-soft)';
  const cardBg = isOk ? '#F0FDF4' : isFailed ? '#FEF2F2' : '#FFFFFF';
  const badgeBg = isOk ? '#DCFCE7' : isFailed ? '#FEE2E2' : isChecking ? '#DBEAFE' : '#F1F5F9';
  const badgeFg = isOk ? '#15803D' : isFailed ? '#DC2626' : isChecking ? '#1D4ED8' : '#64748B';
  const iconBg = preview ? '#18181B' : isOk ? '#DCFCE7' : isFailed ? '#FEE2E2' : isChecking ? '#DBEAFE' : 'var(--admin-bg)';
  const iconFg = preview ? '#FFFFFF' : isOk ? '#16A34A' : isFailed ? '#DC2626' : isChecking ? '#2563EB' : 'var(--admin-accent)';

  return (
    <div
      className="relative rounded-2xl border p-5 flex flex-col gap-3 transition-colors duration-300 hover:shadow-md"
      style={{ borderColor, background: cardBg }}
    >
      <div className="flex items-start justify-between">
        <div
          className="relative w-14 h-14 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
          style={{ background: iconBg, color: iconFg }}
        >
          {preview || icon}
          {isChecking && (
            <span
              className="absolute inset-0 rounded-full border-2 animate-spin"
              style={{ borderColor: 'transparent', borderTopColor: '#2563EB' }}
              aria-hidden="true"
            />
          )}
        </div>
        {isOk && (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#22C55E' }}
            aria-hidden="true"
          >
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </span>
        )}
        {isFailed && (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: '#EF4444' }}
            aria-hidden="true"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </span>
        )}
      </div>

      <div>
        <p className="text-[15px] font-semibold" style={{ color: 'var(--admin-text)' }}>
          {label}
        </p>
        <span
          className="inline-flex items-center mt-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ background: badgeBg, color: badgeFg }}
        >
          <span className="sr-only">Status: </span>
          {badgeText}
        </span>
      </div>

      <p className="text-xs sm:text-[13px] leading-relaxed" style={{ color: isFailed ? '#B91C1C' : 'var(--admin-text-subtle)' }}>
        {description}
      </p>
    </div>
  );
}
