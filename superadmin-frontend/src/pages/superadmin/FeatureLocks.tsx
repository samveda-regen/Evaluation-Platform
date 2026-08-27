import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { superAdminApi, type AdminAccountSummary, type AdminFeatureOverrideView, type FeatureFlag } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader, Select, Toggle } from './components';

const GLOBAL_VIEW = '__global__';
const MAINTENANCE_FLAG_KEY = 'maintenance_mode';

// Most flags gate a capability, so "Locked"/"Unlocked" reads naturally. A few
// (like anomaly_auto_lock) toggle a background behavior rather than blocking
// an action, where "locked" would be confusingly self-referential — those use
// plain Enabled/Disabled wording instead.
const ENABLE_DISABLE_FLAGS = new Set(['anomaly_auto_lock']);

// maintenance_mode reuses the same enabled=true-means-allowed polarity as every
// other flag (so isFeatureEnabledForAdmin/requireFeatureEnabled stay generic —
// see middleware/featureLock.ts) — enabled=true means "operating normally",
// enabled=false means the maintenance block is active. That's the opposite of
// what a human expects "Enabled" to mean for something called "Maintenance
// mode", so it gets its own On/Off wording instead of Enabled/Disabled.
function statusLabel(key: string, enabled: boolean): string {
  if (key === MAINTENANCE_FLAG_KEY) {
    return enabled ? 'Off' : 'On';
  }
  if (ENABLE_DISABLE_FLAGS.has(key)) {
    return enabled ? 'Enabled' : 'Disabled';
  }
  return enabled ? 'Unlocked' : 'Locked';
}

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
      toast.success(`${flag.label} ${statusLabel(flag.key, data.flag.enabled).toLowerCase()} platform-wide`);
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
      toast.success(`${flag.label} ${statusLabel(flag.key, data.effectiveEnabled).toLowerCase()} for this account`);
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
  const maintenanceFlag = flags?.find((flag) => flag.key === MAINTENANCE_FLAG_KEY) ?? null;
  const maintenanceActive = maintenanceFlag !== null && !maintenanceFlag.enabled;

  return (
    <div>
      <PageHeader
        title="Feature Locks"
        description="A master kill switch for platform capabilities. Locking a feature blocks it immediately for every admin — no deploy needed."
      />

      {isGlobalView && maintenanceFlag && (
        <div
          className={`flex items-center justify-between gap-3 mb-4 px-4 py-3 rounded-xl border ${
            maintenanceActive
              ? 'border-sa-critical/40 bg-sa-critical-soft'
              : 'border-sa-line bg-sa-panel-inset'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {maintenanceActive && <AlertTriangle size={16} className="text-sa-critical shrink-0" />}
            <div>
              <div className={`text-[13px] font-semibold ${maintenanceActive ? 'text-sa-critical' : 'text-sa-ink'}`}>
                {maintenanceActive
                  ? 'Maintenance mode is ON — admins cannot log in or take actions'
                  : 'Maintenance mode is off — admin console operating normally'}
              </div>
              <div className="text-[11.5px] text-sa-ink-faint mt-0.5">Candidates already taking a test are never affected.</div>
            </div>
          </div>
          <Toggle
            on={maintenanceFlag.enabled}
            onClick={() => toggleGlobal(maintenanceFlag)}
            disabled={pending === maintenanceFlag.key}
            label="Toggle maintenance mode"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-[11px] text-sa-ink-faint">Scope</span>
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
                  className={`shrink-0 h-8 w-8 rounded-lg border flex items-center justify-center ${
                    flag.enabled
                      ? 'border-sa-line text-sa-ink-dim bg-sa-panel-inset'
                      : 'border-sa-critical/40 text-sa-critical bg-sa-critical-soft'
                  }`}
                >
                  {flag.enabled ? <LockOpen size={14} /> : <Lock size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink">{flag.label}</div>
                  {flag.description && <div className="text-[11.5px] text-sa-ink-faint mt-0.5">{flag.description}</div>}
                </div>
                <span
                  className={`text-[10.5px] font-medium ${
                    flag.enabled ? 'text-sa-good' : 'text-sa-critical'
                  }`}
                >
                  {statusLabel(flag.key, flag.enabled)}
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
                  className={`shrink-0 h-8 w-8 rounded-lg border flex items-center justify-center ${
                    flag.effectiveEnabled
                      ? 'border-sa-line text-sa-ink-dim bg-sa-panel-inset'
                      : 'border-sa-critical/40 text-sa-critical bg-sa-critical-soft'
                  }`}
                >
                  {flag.effectiveEnabled ? <LockOpen size={14} /> : <Lock size={14} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-sa-ink">{flag.label}</div>
                  {flag.description && <div className="text-[11.5px] text-sa-ink-faint mt-0.5">{flag.description}</div>}
                  <div className="text-[11px] text-sa-ink-faint mt-0.5">
                    {flag.overrideEnabled === null
                      ? `Following platform default (${statusLabel(flag.key, flag.globalEnabled).toLowerCase()})`
                      : 'Custom override for this account'}
                  </div>
                </div>
                {flag.overrideEnabled !== null && (
                  <button
                    type="button"
                    onClick={() => resetAccountOverride(flag)}
                    disabled={pending === flag.key}
                    title="Reset to platform default"
                    className="shrink-0 h-8 w-8 rounded-lg border border-sa-line text-sa-ink-faint hover:text-sa-accent hover:border-sa-accent/50 flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <span
                  className={`text-[10.5px] font-medium ${
                    flag.effectiveEnabled ? 'text-sa-good' : 'text-sa-critical'
                  }`}
                >
                  {statusLabel(flag.key, flag.effectiveEnabled)}
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
