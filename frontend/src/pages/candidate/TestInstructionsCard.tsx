import type { ReactNode } from 'react';
import { ShieldCheck, Eye, Users, Info, Play } from 'lucide-react';
import InstructionSlideshow from '../../components/InstructionSlideshow';

export type InstructionTone = 'orange' | 'blue' | 'amber';

export interface InstructionItem {
  key: string;
  icon: ReactNode;
  title: string;
  description: ReactNode;
  tone: InstructionTone;
}

export interface QuestionMixEntry {
  key: string;
  icon: ReactNode;
  label: string;
  count?: number;
}

interface TestInstructionsCardProps {
  testName: string;
  duration: number;
  totalQuestions: number;
  instructionItems: InstructionItem[];
  customInstructions?: string;
  accepted: boolean;
  onAcceptedChange: (checked: boolean) => void;
  checkboxLabel: string;
  canStart: boolean;
  onStart: () => void;
  questionMix: QuestionMixEntry[];
}

const TONE_STYLES: Record<InstructionTone, { bg: string; fg: string }> = {
  orange: { bg: '#FFF1E7', fg: '#C2410C' },
  blue: { bg: '#EAF1FE', fg: 'var(--admin-accent)' },
  amber: { bg: '#FEF3E2', fg: '#B45309' },
};

/**
 * Shared presentational card for the pre-exam "Before you begin" instructions
 * screen, used by both NormalBrowserTestInstructions and SebTestInstructions
 * (which only differ in the page header and the exact set/copy of
 * instruction rows). Keeping this in one place avoids duplicating the
 * two-column layout, question-mix grid, and footer/CTA across both flows.
 */
export default function TestInstructionsCard({
  testName,
  duration,
  totalQuestions,
  instructionItems,
  customInstructions,
  accepted,
  onAcceptedChange,
  checkboxLabel,
  canStart,
  onStart,
  questionMix,
}: TestInstructionsCardProps) {
  return (
    <div className="w-full max-w-[1160px] mx-auto">
      <div className="bg-white rounded-3xl shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[60%_40%]">
          {/* Left column — assessment info, instructions, CTA */}
          <div className="p-6 sm:p-8 lg:p-10">
            <p className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--admin-accent)' }}>
              Before You Begin
            </p>
            <h1 className="mt-2 text-2xl sm:text-[28px] font-bold tracking-tight" style={{ color: 'var(--admin-text)' }}>
              Important Instructions
            </h1>
            <p className="mt-2 text-sm sm:text-[15px]" style={{ color: 'var(--admin-text-muted)' }}>
              {testName}
              {duration ? ` · ${duration} minutes` : ''}
              {totalQuestions > 0 ? ` · ${totalQuestions} questions` : ''}
            </p>

            <div className="mt-6 divide-y" style={{ borderColor: 'var(--admin-border-soft)' }}>
              {instructionItems.map((item) => {
                const tone = TONE_STYLES[item.tone];
                return (
                  <div key={item.key} className="flex items-start gap-4 py-4 first:pt-0 last:pb-0" style={{ borderColor: 'var(--admin-border-soft)' }}>
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{item.title}</p>
                      <p className="text-sm mt-0.5 leading-relaxed" style={{ color: 'var(--admin-text-muted)' }}>{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {customInstructions && (
              <div className="mt-5 pt-5 border-t" style={{ borderColor: 'var(--admin-border-soft)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--admin-text-subtle)' }}>
                  Additional Instructions
                </p>
                <pre className="whitespace-pre-wrap font-sans text-sm" style={{ color: 'var(--admin-text-muted)' }}>
                  {customInstructions}
                </pre>
              </div>
            )}

            <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--admin-border-soft)' }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => onAcceptedChange(e.target.checked)}
                  className="w-[18px] h-[18px] mt-0.5 rounded flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                  style={{ accentColor: 'var(--admin-accent)' }}
                />
                <span className="text-sm leading-relaxed" style={{ color: 'var(--admin-text)' }}>
                  {checkboxLabel}
                </span>
              </label>

              <button
                type="button"
                onClick={onStart}
                disabled={!canStart}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{ height: 50, background: canStart ? 'var(--admin-accent)' : '#9CA3AF' }}
                onMouseEnter={(e) => { if (canStart) e.currentTarget.style.background = 'var(--admin-accent-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = canStart ? 'var(--admin-accent)' : '#9CA3AF'; }}
              >
                <Play className="w-4 h-4" fill="currentColor" aria-hidden="true" />
                Start assessment
              </button>

              <p className="text-xs mt-2 text-center" style={{ color: 'var(--admin-text-subtle)' }}>
                Timer starts when you click start
              </p>
            </div>
          </div>

          {/* Right column — readiness / security / support */}
          <div
            className="flex flex-col p-6 sm:p-8 lg:p-10 border-t lg:border-t-0 lg:border-l"
            style={{ background: '#F8FAFC', borderColor: 'var(--admin-border-soft)' }}
          >
            <h2 className="text-base font-bold" style={{ color: 'var(--admin-text)' }}>
              Ready for a fair assessment?
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--admin-text-muted)' }}>
              These guidelines help maintain a secure and consistent assessment experience for every candidate.
            </p>

            <div className="mt-5 space-y-4">
              <TrustRow
                icon={<ShieldCheck className="w-4 h-4" aria-hidden="true" />}
                title="Secure"
                description="Your assessment environment is protected."
              />
              <TrustRow
                icon={<Eye className="w-4 h-4" aria-hidden="true" />}
                title="Proctored"
                description="Your camera, microphone and screen may be monitored according to the assessment rules."
              />
              <TrustRow
                icon={<Users className="w-4 h-4" aria-hidden="true" />}
                title="Fair"
                description="The same assessment rules apply to all candidates."
              />
            </div>

            <InstructionSlideshow />

            <div
              className="mt-auto pt-5"
            >
              <div className="rounded-xl border px-4 py-3.5 flex gap-2.5" style={{ background: '#FFFFFF', borderColor: 'var(--admin-border-soft)' }}>
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--admin-text-subtle)' }} aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--admin-text)' }}>Need help?</p>
                  <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--admin-text-subtle)' }}>
                    If you experience technical issues, contact the support team before starting your assessment.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Question mix */}
      {questionMix.length > 0 && (
      <div
        className="bg-white rounded-3xl shadow-[0_8px_40px_-12px_rgba(15,23,42,0.12)] mt-6 p-6 sm:p-8"
      >
        <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>Question mix</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {questionMix.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center gap-3 rounded-xl border px-4 py-3.5"
              style={{ borderColor: 'var(--admin-border-soft)' }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--admin-bg)', color: 'var(--admin-accent)' }}
              >
                {entry.icon}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{entry.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--admin-text-subtle)' }}>{entry.count ?? 0} questions</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

function TrustRow({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: '#EAF1FE', color: 'var(--admin-accent)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--admin-text)' }}>{title}</p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--admin-text-subtle)' }}>{description}</p>
      </div>
    </div>
  );
}
