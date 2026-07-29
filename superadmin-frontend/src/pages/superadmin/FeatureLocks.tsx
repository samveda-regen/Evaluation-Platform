import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Lock, LockOpen, RotateCcw } from 'lucide-react';
import { superAdminApi, type AdminAccountSummary, type AdminFeatureOverrideView, type FeatureFlag } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader, Select, Toggle } from './components';

const GLOBAL_VIEW = '__global__';

export default function SuperAdminFeatureLocks() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [accounts, setAccounts] = useState<AdminAccountSummary[] | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(GLOBAL_VIEW);
  const [accountFlags, setAccountFlags] = useState<AdminFeatureOverrideView[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const loadGlobal = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listFeatureFlags();
      setFlags(data.flags);
    } catch {
      toast.error('Failed to load feature flags');
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listAccounts();
      setAccounts(data.admins);
    } catch {
      toast.error('Failed to load accounts');
    }
  }, []);

  const loadAccountFlags = useCallback(async (adminId: string) => {
    try {
      const { data } = await superAdminApi.getAdminFeatureOverrides(adminId);
      setAccountFlags(data.flags);
    } catch {
      toast.error('Failed to load feature overrides for this account');
    }
  }, []);

  useEffect(() => {
    void loadGlobal();
    void loadAccounts();
  }, [loadGlobal, loadAccounts]);

  useEffect(() => {
    if (selectedAccountId === GLOBAL_VIEW) {
      setAccountFlags(null);
      return;
    }
    setAccountFlags(null);
    void loadAccountFlags(selectedAccountId);
  }, [selectedAccountId, loadAccountFlags]);

  const toggleGlobal = async (flag: FeatureFlag) => {
    setPending(flag.key);
    try {
      const { data } = await superAdminApi.toggleFeatureFlag(flag.key, { enabled: !flag.enabled });
      setFlags((prev) => prev?.map((f) => (f.key === flag.key ? data.flag : f)) ?? null);
      toast.success(`${flag.label} ${data.flag.enabled ? 'unlocked' : 'locked'} platform-wide`);
    } catch {
      toast.error('Failed to update feature flag');
    } finally {
      setPending(null);
    }
  };

  const toggleAccountOverride = async (flag: AdminFeatureOverrideView) => {
    setPending(flag.key);
    try {
      const { data } = await superAdminApi.setAdminFeatureOverride(selectedAccountId, flag.key, !flag.effectiveEnabled);
      setAccountFlags((prev) => prev?.map((f) => (f.key === flag.key ? data : f)) ?? null);
      toast.success(`${flag.label} ${data.effectiveEnabled ? 'unlocked' : 'locked'} for this account`);
    } catch {
      toast.error('Failed to update feature override');
    } finally {
      setPending(null);
    }
  };

  const resetAccountOverride = async (flag: AdminFeatureOverrideView) => {
    setPending(flag.key);
    try {
      const { data } = await superAdminApi.clearAdminFeatureOverride(selectedAccountId, flag.key);
      setAccountFlags((prev) => prev?.map((f) => (f.key === flag.key ? data : f)) ?? null);
      toast.success(`${flag.label} now follows the platform-wide default`);
    } catch {
      toast.error('Failed to reset feature override');
    } finally {
      setPending(null);
    }
  };

  const selectedAccount = accounts?.find((account) => account.id === selectedAccountId);
  const isGlobalView = selectedAccountId === GLOBAL_VIEW;

  return (
    <div>
      <PageHeader
        title="Feature Locks"
        description="A master kill switch for platform capabilities. Locking a feature blocks it immediately for every admin — no deploy needed."
      />

      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-sa-ink-faint">Scope</span>
        <Select
          value={selectedAccountId}
          onChange={setSelectedAccountId}
          placeholder="All accounts (platform-wide)"
          options={[
            { value: GLOBAL_VIEW, label: 'All accounts (platform-wide)' },
            ...(accounts ?? []).map((account) => ({
              value: account.id,
              label: account.name || account.email,
            })),
          ]}
        />
      </div>

      {isGlobalView ? (
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
                <Toggle on={flag.enabled} onClick={() => toggleGlobal(flag)} disabled={pending === flag.key} label={`Toggle ${flag.label}`} />
              </div>
            ))}
            {flags?.length === 0 && <EmptyState>No feature flags configured.</EmptyState>}
            {flags === null && <EmptyState>Loading…</EmptyState>}
          </div>
        </Card>
      ) : (
        <Card
          title={`Overrides for ${selectedAccount?.name || selectedAccount?.email || 'account'}`}
          meta={accountFlags ? `${accountFlags.length} features` : undefined}
        >
          <div>
            {accountFlags?.map((flag) => (
              <div key={flag.key} className="flex items-center gap-3.5 py-3.5 border-b border-sa-line-soft last:border-0">
                <div
                  className={`shrink-0 h-8 w-8 rounded-sm border flex items-center justify-center ${
                    flag.effectiveEnabled
                      ? 'border-sa-line text-sa-ink-dim bg-sa-panel-inset'
                      : 'border-sa-critical/40 text-sa-critical bg-sa-critical-soft shadow-glow-red'
                  }`}
                >
                  {flag.effectiveEnabled ? <LockOpen size={14} /> : <Lock size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink">{flag.label}</div>
                  {flag.description && <div className="text-[11.5px] text-sa-ink-faint mt-0.5">{flag.description}</div>}
                  <div className="text-[11px] text-sa-ink-faint mt-0.5 font-mono">
                    {flag.overrideEnabled === null
                      ? `Following platform default (${flag.globalEnabled ? 'unlocked' : 'locked'})`
                      : 'Custom override for this account'}
                  </div>
                </div>
                {flag.overrideEnabled !== null && (
                  <button
                    type="button"
                    onClick={() => resetAccountOverride(flag)}
                    disabled={pending === flag.key}
                    title="Reset to platform default"
                    className="shrink-0 h-8 w-8 rounded-sm border border-sa-line text-sa-ink-faint hover:text-sa-accent hover:border-sa-accent/50 flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <span
                  className={`font-mono text-[10.5px] uppercase tracking-[0.08em] ${
                    flag.effectiveEnabled ? 'text-sa-good' : 'text-sa-critical'
                  }`}
                >
                  {flag.effectiveEnabled ? 'Unlocked' : 'Locked'}
                </span>
                <Toggle
                  on={flag.effectiveEnabled}
                  onClick={() => toggleAccountOverride(flag)}
                  disabled={pending === flag.key}
                  label={`Toggle ${flag.label} for this account`}
                />
              </div>
            ))}
            {accountFlags?.length === 0 && <EmptyState>No feature flags configured.</EmptyState>}
            {accountFlags === null && <EmptyState>Loading…</EmptyState>}
          </div>
        </Card>
      )}
    </div>
  );
}
