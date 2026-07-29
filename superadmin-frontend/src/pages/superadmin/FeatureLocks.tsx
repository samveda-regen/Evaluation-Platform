import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Lock, LockOpen } from 'lucide-react';
import { superAdminApi, type FeatureFlag } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader, Toggle } from './components';

export default function SuperAdminFeatureLocks() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listFeatureFlags();
      setFlags(data.flags);
    } catch {
      toast.error('Failed to load feature flags');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (flag: FeatureFlag) => {
    setPending(flag.key);
    try {
      const { data } = await superAdminApi.toggleFeatureFlag(flag.key, { enabled: !flag.enabled, scope: 'GLOBAL' });
      setFlags((prev) => prev?.map((f) => (f.key === flag.key ? data.flag : f)) ?? null);
      toast.success(`${flag.label} ${data.flag.enabled ? 'unlocked' : 'locked'}`);
    } catch {
      toast.error('Failed to update feature flag');
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Feature Locks"
        description="A master kill switch for platform capabilities. Locking a feature blocks it immediately for every admin — no deploy needed."
      />

      <Card title="Platform-wide capabilities" meta={flags ? `${flags.length} features` : undefined}>
        <div>
          {flags?.map((flag) => (
            <div key={flag.key} className="flex items-center gap-3.5 py-3.5 border-b border-sa-line-soft last:border-0">
              <div
                className={`shrink-0 h-8 w-8 rounded-sm border flex items-center justify-center ${
                  flag.enabled
                    ? 'border-sa-line text-sa-ink-dim bg-sa-panel-inset'
                    : 'border-sa-critical/40 text-sa-critical bg-sa-critical-soft shadow-glow-red'
                }`}
              >
                {flag.enabled ? <LockOpen size={14} /> : <Lock size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-sa-ink">{flag.label}</div>
                {flag.description && <div className="text-[11.5px] text-sa-ink-faint mt-0.5">{flag.description}</div>}
              </div>
              <span
                className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                  flag.enabled ? 'text-sa-good' : 'text-sa-critical'
                }`}
              >
                {flag.enabled ? 'Unlocked' : 'Locked'}
              </span>
              <Toggle on={flag.enabled} onClick={() => toggle(flag)} disabled={pending === flag.key} label={`Toggle ${flag.label}`} />
            </div>
          ))}
          {flags?.length === 0 && <EmptyState>No feature flags configured.</EmptyState>}
          {flags === null && <EmptyState>Loading…</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
