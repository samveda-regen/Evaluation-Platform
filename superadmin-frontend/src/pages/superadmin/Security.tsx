import { useEffect, useState, useCallback, type FormEvent } from 'react';
import QRCode from 'react-qr-code';
import { toast } from 'react-hot-toast';
import { ShieldCheck, ShieldOff, Trash2, LogOut, Plus, Globe } from 'lucide-react';
import {
  superAdminApi,
  type IpAllowlistEntry,
  type SuperAdminTeamMember,
} from '../../services/superAdminApi';
import { useSuperAdminStore } from '../../context/superAdminStore';
import { Card, StatusPill, EmptyState, PageHeader, Toggle } from './components';

function TwoFactorCard() {
  const superAdmin = useSuperAdminStore((s) => s.superAdmin);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getProfile();
      setEnabled(data.superAdmin.totpEnabled);
    } catch {
      toast.error('Failed to load 2FA status');
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const { data } = await superAdminApi.setupTotp();
      setEnrolling(data);
    } catch {
      toast.error('Failed to start 2FA setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await superAdminApi.verifyTotpSetup(code);
      toast.success('Two-factor authentication enabled');
      setEnrolling(null);
      setCode('');
      void loadProfile();
    } catch {
      toast.error('Invalid code — try again');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await superAdminApi.disableTotp(disableCode);
      toast.success('Two-factor authentication disabled');
      setDisableCode('');
      void loadProfile();
    } catch {
      toast.error('Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Two-factor authentication" meta={superAdmin?.email}>
      {enabled === null ? (
        <EmptyState>Loading…</EmptyState>
      ) : enrolling ? (
        <form onSubmit={confirmSetup} className="space-y-3">
          <p className="text-[12.5px] text-sa-ink-dim">
            Scan with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code to confirm.
          </p>
          <div className="bg-white p-3 rounded-sm w-fit">
            <QRCode value={enrolling.otpauthUrl} size={140} />
          </div>
          <p className="font-mono text-[11px] text-sa-ink-faint break-all">Manual entry: {enrolling.secret}</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-40 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono tracking-[0.3em] text-center"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-accent text-sa-void font-bold shadow-glow-cyan disabled:opacity-60 transition-all"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setEnrolling(null)}
              className="font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-line text-sa-ink-dim transition-all"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : enabled ? (
        <form onSubmit={disable} className="space-y-3">
          <StatusPill tone="good">Enabled</StatusPill>
          <p className="text-[12.5px] text-sa-ink-dim">Enter a current code to disable 2FA.</p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-40 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-critical transition-all font-mono tracking-[0.3em] text-center"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-critical/40 text-sa-critical hover:shadow-glow-red transition-all disabled:opacity-60"
            >
              <ShieldOff size={14} /> Disable
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <StatusPill tone="dim">Disabled</StatusPill>
          <button
            onClick={() => void startSetup()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-accent text-sa-void font-bold shadow-glow-cyan disabled:opacity-60 transition-all"
          >
            <ShieldCheck size={14} /> Enable 2FA
          </button>
        </div>
      )}
    </Card>
  );
}

function IpAllowlistCard() {
  const [entries, setEntries] = useState<IpAllowlistEntry[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cidrOrIp, setCidrOrIp] = useState('');
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listIpAllowlist();
      setEntries(data.entries);
      setEnabled(data.ipAllowlistEnabled);
    } catch {
      toast.error('Failed to load IP allowlist');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addEntry = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await superAdminApi.addIpAllowlistEntry(cidrOrIp, label || undefined);
      setCidrOrIp('');
      setLabel('');
      toast.success('Entry added');
      void load();
    } catch {
      toast.error('Failed to add entry');
    }
  };

  const removeEntry = async (id: string) => {
    try {
      await superAdminApi.deleteIpAllowlistEntry(id);
      void load();
    } catch {
      toast.error('Failed to remove entry');
    }
  };

  const toggle = async (next: boolean) => {
    try {
      const { data } = await superAdminApi.toggleIpAllowlist(next);
      setEnabled(data.ipAllowlistEnabled);
      toast.success(next ? 'IP allowlist enabled' : 'IP allowlist disabled');
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || 'Failed to update allowlist');
    }
  };

  return (
    <Card title="Superadmin IP allowlist" meta={<Globe size={13} className="text-sa-ink-faint" />}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12.5px] text-sa-ink-dim max-w-sm">
          When enabled, superadmin login only succeeds from an IP/CIDR listed below.
        </p>
        <Toggle on={enabled} onClick={() => void toggle(!enabled)} label="Toggle IP allowlist" />
      </div>

      <form onSubmit={addEntry} className="flex gap-2 mb-3">
        <input
          required
          placeholder="e.g. 203.0.113.4 or 203.0.113.0/24"
          value={cidrOrIp}
          onChange={(e) => setCidrOrIp(e.target.value)}
          className="flex-1 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
        />
        <input
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-40 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
        />
        <button
          type="submit"
          className="shrink-0 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-sa-accent border border-sa-accent/40 rounded-sm px-2.5 hover:shadow-glow-cyan-sm transition-all"
        >
          <Plus size={13} /> Add
        </button>
      </form>

      <div className="space-y-1.5">
        {entries?.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2">
            <div>
              <span className="font-mono text-[12.5px] text-sa-ink">{entry.cidrOrIp}</span>
              {entry.label && <span className="ml-2 text-[11px] text-sa-ink-faint">{entry.label}</span>}
            </div>
            <button onClick={() => void removeEntry(entry.id)} className="text-sa-ink-faint hover:text-sa-critical transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {entries?.length === 0 && <EmptyState>No entries yet.</EmptyState>}
      </div>
    </Card>
  );
}

function TeamCard() {
  const currentSuperAdmin = useSuperAdminStore((s) => s.superAdmin);
  const [team, setTeam] = useState<SuperAdminTeamMember[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'full_control' | 'read_only'>('read_only');

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listSuperAdminTeam();
      setTeam(data.superAdmins);
    } catch {
      toast.error('Failed to load superadmin team');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createMember = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await superAdminApi.createSuperAdminTeamMember({ email, password, name, role });
      toast.success('Superadmin created');
      setEmail('');
      setPassword('');
      setName('');
      setShowForm(false);
      void load();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create';
      toast.error(message);
    }
  };

  const removeMember = async (id: string) => {
    if (!window.confirm('Remove this superadmin account?')) return;
    try {
      await superAdminApi.deleteSuperAdminTeamMember(id);
      toast.success('Removed');
      void load();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to remove';
      toast.error(message);
    }
  };

  const forceLogout = async (id: string) => {
    try {
      await superAdminApi.forceLogoutSuperAdmin(id);
      toast.success('Sessions revoked');
    } catch {
      toast.error('Failed to force logout');
    }
  };

  return (
    <Card
      title="Superadmin team"
      meta={
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-sa-accent hover:shadow-glow-cyan-sm border border-sa-accent/40 rounded-full px-2.5 py-1 transition-all"
        >
          <Plus size={12} /> Add member
        </button>
      }
    >
      {showForm && (
        <form onSubmit={createMember} className="grid grid-cols-2 gap-2 mb-4 p-3 border border-sa-line rounded-sm bg-sa-panel-inset">
          <input
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-sa-panel border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-sa-panel border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
          />
          <input
            required
            type="password"
            placeholder="Password (12+ chars)"
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-sa-panel border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'full_control' | 'read_only')}
            className="bg-sa-panel border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
          >
            <option value="read_only">Read-only observer</option>
            <option value="full_control">Full control</option>
          </select>
          <button
            type="submit"
            className="col-span-2 font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-accent text-sa-void font-bold shadow-glow-cyan transition-all"
          >
            Create
          </button>
        </form>
      )}

      <div className="space-y-1.5">
        {team?.map((member) => (
          <div key={member.id} className="flex items-center justify-between bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2.5">
            <div>
              <div className="text-[13px] text-sa-ink">{member.name}</div>
              <div className="font-mono text-[11px] text-sa-ink-faint">{member.email}</div>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={member.role === 'full_control' ? 'good' : 'dim'}>
                {member.role === 'full_control' ? 'Full control' : 'Read-only'}
              </StatusPill>
              <button
                onClick={() => void forceLogout(member.id)}
                title="Force logout"
                className="p-1.5 text-sa-ink-faint hover:text-sa-warn transition-colors"
              >
                <LogOut size={14} />
              </button>
              {member.id !== currentSuperAdmin?.id && (
                <button
                  onClick={() => void removeMember(member.id)}
                  title="Remove"
                  className="p-1.5 text-sa-ink-faint hover:text-sa-critical transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {team?.length === 0 && <EmptyState>No other superadmins yet.</EmptyState>}
      </div>
    </Card>
  );
}

export default function SuperAdminSecurity() {
  return (
    <div>
      <PageHeader
        title="Security"
        description="Two-factor authentication, login IP restrictions, and superadmin team access levels."
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <TwoFactorCard />
        <IpAllowlistCard />
      </div>
      <TeamCard />
    </div>
  );
}
