import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { toast } from 'react-hot-toast';
import { Plus, Pencil, Trash2, Ban, RotateCcw, Receipt, Sparkles } from 'lucide-react';
import {
  superAdminApi,
  type BillingSettings,
  type BillingPlan,
  type AdminBillingOverviewRow,
  type RevenueOverview,
  type UsageTrendPoint,
  type BillingInvoice,
} from '../../services/superAdminApi';
import { Card, KpiTile, StatusPill, EmptyState, PageHeader, Toggle } from './components';

function fmtMoney(value: number | null): string {
  if (value === null) return 'Custom';
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtLimit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString();
}

const tooltipStyle = {
  contentStyle: {
    background: '#141026',
    border: '1px solid #3D2E66',
    borderRadius: 2,
    fontSize: 12,
    boxShadow: '0 0 20px rgba(0,240,255,0.15)',
  },
  labelStyle: { color: '#8D8FB8' },
};

const gridProps = {
  cartesian: { stroke: '#1A1430', vertical: false as const },
  xAxis: { tick: { fill: '#56587A', fontSize: 10 }, axisLine: { stroke: '#241B3D' }, tickLine: false as const, minTickGap: 30 },
  yAxis: { tick: { fill: '#56587A', fontSize: 10 }, axisLine: false as const, tickLine: false as const, width: 32 },
};

interface PlanFormState {
  key: string;
  label: string;
  description: string;
  priceMonthly: string;
  maxTests: string;
  maxAiGenerations: string;
  maxInvitationsPerCycle: string;
  maxConcurrentProctoring: string;
  maxCustomQuestions: string;
  maxStorageMb: string;
}

const EMPTY_PLAN_FORM: PlanFormState = {
  key: '',
  label: '',
  description: '',
  priceMonthly: '',
  maxTests: '',
  maxAiGenerations: '',
  maxInvitationsPerCycle: '',
  maxConcurrentProctoring: '',
  maxCustomQuestions: '',
  maxStorageMb: '',
};

function planToForm(plan: BillingPlan): PlanFormState {
  return {
    key: plan.key,
    label: plan.label,
    description: plan.description ?? '',
    priceMonthly: plan.priceMonthly === null ? '' : String(plan.priceMonthly),
    maxTests: plan.maxTests === null ? '' : String(plan.maxTests),
    maxAiGenerations: plan.maxAiGenerations === null ? '' : String(plan.maxAiGenerations),
    maxInvitationsPerCycle: plan.maxInvitationsPerCycle === null ? '' : String(plan.maxInvitationsPerCycle),
    maxConcurrentProctoring: plan.maxConcurrentProctoring === null ? '' : String(plan.maxConcurrentProctoring),
    maxCustomQuestions: plan.maxCustomQuestions === null ? '' : String(plan.maxCustomQuestions),
    maxStorageMb: plan.maxStorageMb === null ? '' : String(plan.maxStorageMb),
  };
}

function formToPayload(form: PlanFormState) {
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return {
    key: form.key,
    label: form.label,
    description: form.description || null,
    priceMonthly: num(form.priceMonthly),
    maxTests: num(form.maxTests),
    maxAiGenerations: num(form.maxAiGenerations),
    maxInvitationsPerCycle: num(form.maxInvitationsPerCycle),
    maxConcurrentProctoring: num(form.maxConcurrentProctoring),
    maxCustomQuestions: num(form.maxCustomQuestions),
    maxStorageMb: num(form.maxStorageMb),
  };
}

const PLAN_FIELDS: { key: keyof PlanFormState; label: string; placeholder: string }[] = [
  { key: 'priceMonthly', label: 'Price / mo ($)', placeholder: 'blank = custom' },
  { key: 'maxTests', label: 'Max tests / cycle', placeholder: 'blank = unlimited' },
  { key: 'maxAiGenerations', label: 'Max AI generations / cycle', placeholder: 'blank = unlimited' },
  { key: 'maxInvitationsPerCycle', label: 'Max invitations / cycle', placeholder: 'blank = unlimited' },
  { key: 'maxConcurrentProctoring', label: 'Max concurrent proctoring', placeholder: 'blank = unlimited' },
  { key: 'maxCustomQuestions', label: 'Max custom questions', placeholder: 'blank = unlimited' },
  { key: 'maxStorageMb', label: 'Max storage (MB)', placeholder: 'blank = unlimited' },
];

function UsageBar({ current, limit }: { current: number; limit: number | null }) {
  const pct = limit === null || limit === 0 ? 0 : Math.min(100, (current / limit) * 100);
  const tone = limit !== null && current >= limit ? '#FF2E63' : pct > 85 ? '#FFD426' : '#00F0FF';
  return (
    <div className="w-24">
      <div className="h-1.5 rounded-full bg-sa-panel-inset border border-sa-line overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <div className="font-mono text-[10.5px] text-sa-ink-faint mt-0.5">
        {current}/{limit === null ? '∞' : limit}
      </div>
    </div>
  );
}

export default function SuperAdminBilling() {
  const [settings, setSettings] = useState<BillingSettings | null>(null);
  const [plans, setPlans] = useState<BillingPlan[] | null>(null);
  const [rows, setRows] = useState<AdminBillingOverviewRow[] | null>(null);
  const [revenue, setRevenue] = useState<RevenueOverview | null>(null);
  const [trend, setTrend] = useState<UsageTrendPoint[]>([]);
  const [trendDays, setTrendDays] = useState(30);

  const [editingPlan, setEditingPlan] = useState<PlanFormState | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);
  const [managingAdminId, setManagingAdminId] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getBillingSettings();
      setSettings(data.settings);
    } catch {
      toast.error('Failed to load billing settings');
    }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listBillingPlans();
      setPlans(data.plans);
    } catch {
      toast.error('Failed to load billing plans');
    }
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listAdminBillingOverview();
      setRows(data.rows);
    } catch {
      toast.error('Failed to load admin billing overview');
    }
  }, []);

  const loadRevenue = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getRevenueOverview();
      setRevenue(data);
    } catch {
      toast.error('Failed to load revenue overview');
    }
  }, []);

  const loadTrend = useCallback(async (days: number) => {
    try {
      const { data } = await superAdminApi.getUsageTrend(days);
      setTrend(data.trend);
    } catch {
      toast.error('Failed to load usage trend');
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadPlans();
    void loadOverview();
    void loadRevenue();
  }, [loadSettings, loadPlans, loadOverview, loadRevenue]);

  useEffect(() => {
    void loadTrend(trendDays);
  }, [loadTrend, trendDays]);

  const toggleBilling = async (enabled: boolean) => {
    const previous = settings;
    setSettings((s) => (s ? { ...s, enabled } : s));
    try {
      const { data } = await superAdminApi.toggleBillingEnabled(enabled);
      setSettings(data.settings);
      toast.success(enabled ? 'Billing enforcement enabled' : 'Billing enforcement disabled');
    } catch {
      setSettings(previous);
      toast.error('Failed to update billing settings');
    }
  };

  const savePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;
    setSavingPlan(true);
    try {
      const payload = formToPayload(editingPlan);
      const existing = plans?.find((p) => p.key === editingPlan.key);
      if (existing) {
        await superAdminApi.updateBillingPlan(existing.id, payload);
        toast.success('Plan updated');
      } else {
        await superAdminApi.createBillingPlan(payload);
        toast.success('Plan created');
      }
      setEditingPlan(null);
      void loadPlans();
      void loadOverview();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed';
      toast.error(message);
    } finally {
      setSavingPlan(false);
    }
  };

  const deletePlan = async (plan: BillingPlan) => {
    if (!window.confirm(`Delete plan "${plan.label}"?`)) return;
    try {
      await superAdminApi.deleteBillingPlan(plan.id);
      toast.success('Plan deleted');
      void loadPlans();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Delete failed';
      toast.error(message);
    }
  };

  const managingRow = rows?.find((r) => r.admin.id === managingAdminId) ?? null;

  const chartData = trend.map((t) => ({
    date: new Date(t.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    testsCreated: t.testsCreated,
    aiTestsCreated: t.aiTestsCreated,
    invitationsSent: t.invitationsSent,
  }));

  return (
    <div>
      <PageHeader
        title="Billing & Plans"
        description="Plan tiers, usage quotas, and manual billing records for every exam-portal admin. This is a preview subsystem — nothing is enforced until it's switched on below."
      />

      <Card className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[13px] font-semibold text-sa-ink tracking-wide uppercase font-mono mb-1">
            Billing enforcement
          </h3>
          <p className="text-[12.5px] text-sa-ink-dim max-w-lg">
            When disabled, quotas below are informational only — no admin action is ever blocked. Preview feature, pending
            board approval.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill tone={settings?.enabled ? 'good' : 'dim'}>{settings?.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
          <Toggle
            on={!!settings?.enabled}
            onClick={() => void toggleBilling(!settings?.enabled)}
            label="Toggle billing enforcement"
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiTile label="MRR" value={fmtMoney(revenue?.mrr ?? null)} tone="good" />
        <KpiTile label="Active paying admins" value={revenue?.activePayingCount ?? '—'} />
        <KpiTile label="Trialing" value={revenue?.trialingCount ?? '—'} />
        <KpiTile label="Suspended" value={revenue?.suspendedCount ?? '—'} tone={revenue?.suspendedCount ? 'warn' : 'default'} />
      </div>

      <Card
        title="Usage trend"
        meta={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setTrendDays(d)}
                className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full border transition-all ${
                  trendDays === d
                    ? 'border-sa-accent text-sa-accent bg-sa-accent-soft'
                    : 'border-sa-line text-sa-ink-faint hover:border-sa-line-bright'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        }
        className="mb-6"
      >
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="testsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00F0FF" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#00F0FF" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="aiFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF2ED1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#FF2ED1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps.cartesian} />
              <XAxis dataKey="date" {...gridProps.xAxis} />
              <YAxis {...gridProps.yAxis} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }} />
              <Area
                type="monotone"
                dataKey="testsCreated"
                name="Tests created"
                stroke="#00F0FF"
                strokeWidth={2}
                fill="url(#testsFill)"
              />
              <Area
                type="monotone"
                dataKey="aiTestsCreated"
                name="AI-generated"
                stroke="#FF2ED1"
                strokeWidth={2}
                fill="url(#aiFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState>Not enough data yet for a trend line.</EmptyState>
        )}
      </Card>

      <Card
        title="Plans"
        meta={
          <button
            onClick={() => setEditingPlan(EMPTY_PLAN_FORM)}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-sa-accent hover:shadow-glow-cyan-sm border border-sa-accent/40 rounded-full px-2.5 py-1 transition-all"
          >
            <Plus size={12} /> New plan
          </button>
        }
        className="mb-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {plans?.map((plan) => (
            <div key={plan.id} className="border border-sa-line rounded-sm p-3.5 bg-sa-panel-inset relative">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-[13px] font-semibold text-sa-ink">{plan.label}</div>
                  <div className="font-mono text-[11px] text-sa-accent mt-0.5">{fmtMoney(plan.priceMonthly)}/mo</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditingPlan(planToForm(plan))}
                    className="p-1 text-sa-ink-faint hover:text-sa-accent transition-colors"
                  >
                    <Pencil size={13} />
                  </button>
                  {plan.isCustom && (
                    <button
                      onClick={() => void deletePlan(plan)}
                      className="p-1 text-sa-ink-faint hover:text-sa-critical transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2.5 space-y-1 font-mono text-[11px] text-sa-ink-dim">
                <div>Tests: {fmtLimit(plan.maxTests)}</div>
                <div>AI generations: {fmtLimit(plan.maxAiGenerations)}</div>
                <div>Invitations: {fmtLimit(plan.maxInvitationsPerCycle)}</div>
                <div>Concurrent proctoring: {fmtLimit(plan.maxConcurrentProctoring)}</div>
                <div>Custom questions: {fmtLimit(plan.maxCustomQuestions)}</div>
                <div>Storage: {plan.maxStorageMb === null ? 'Unlimited' : `${plan.maxStorageMb} MB`}</div>
              </div>
            </div>
          ))}
          {plans?.length === 0 && <EmptyState>No plans configured yet.</EmptyState>}
        </div>
      </Card>

      <Card title="Admin billing" meta={rows ? `${rows.length} admin(s)` : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-sa-line text-left">
                {['Admin', 'Plan', 'Status', 'Tests', 'AI gens', 'Invitations', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-mono text-[10px] tracking-[0.06em] uppercase text-sa-ink-faint font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={row.admin.id} className="border-b border-sa-line-soft last:border-0">
                  <td className="px-3 py-2.5">
                    <div className="text-sa-ink">{row.admin.name}</div>
                    <div className="font-mono text-[11px] text-sa-ink-faint">{row.admin.email}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-sa-ink-dim">{row.plan.label}</td>
                  <td className="px-3 py-2.5">
                    <StatusPill tone={row.billing.status === 'suspended' ? 'critical' : row.billing.status === 'active' ? 'good' : 'dim'}>
                      {row.billing.status}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2.5">
                    <UsageBar current={row.usage.testsThisCycle} limit={row.plan.maxTests} />
                  </td>
                  <td className="px-3 py-2.5">
                    <UsageBar
                      current={row.usage.aiGenerationsThisCycle}
                      limit={row.plan.maxAiGenerations === null ? null : row.plan.maxAiGenerations + row.billing.addOnAiGenerations}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <UsageBar current={row.usage.invitationsThisCycle} limit={row.plan.maxInvitationsPerCycle} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setManagingAdminId(row.admin.id)}
                      className="font-mono text-[11.5px] uppercase tracking-wide text-sa-accent border border-sa-accent/40 rounded-sm px-2.5 py-1.5 hover:shadow-glow-cyan-sm transition-all"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows?.length === 0 && <EmptyState>No admin accounts yet.</EmptyState>}
          {rows === null && <EmptyState>Loading billing overview…</EmptyState>}
        </div>
      </Card>

      {editingPlan && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <form
            onSubmit={savePlan}
            className="relative w-full max-w-lg bg-sa-panel-raised border border-sa-accent/40 rounded-sm p-6 shadow-[0_0_50px_rgba(0,240,255,0.12)] max-h-[85vh] overflow-y-auto"
          >
            <span className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sa-accent to-transparent" />
            <h2 className="font-mono text-sm font-semibold text-sa-ink uppercase tracking-wide mb-4">
              {plans?.some((p) => p.key === editingPlan.key) ? `Edit ${editingPlan.label}` : 'New plan'}
            </h2>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Key</label>
                <input
                  required
                  disabled={plans?.some((p) => p.key === editingPlan.key)}
                  value={editingPlan.key}
                  onChange={(e) => setEditingPlan((f) => (f ? { ...f, key: e.target.value } : f))}
                  className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Label</label>
                <input
                  required
                  value={editingPlan.label}
                  onChange={(e) => setEditingPlan((f) => (f ? { ...f, label: e.target.value } : f))}
                  className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
                />
              </div>
            </div>

            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Description</label>
            <input
              value={editingPlan.description}
              onChange={(e) => setEditingPlan((f) => (f ? { ...f, description: e.target.value } : f))}
              className="w-full mb-3 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              {PLAN_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
                    {field.label}
                  </label>
                  <input
                    type="number"
                    placeholder={field.placeholder}
                    value={editingPlan[field.key]}
                    onChange={(e) => setEditingPlan((f) => (f ? { ...f, [field.key]: e.target.value } : f))}
                    className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPlan(null)}
                disabled={savingPlan}
                className="font-mono text-[12.5px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-line text-sa-ink-dim hover:border-sa-line-bright transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPlan}
                className="font-mono text-[12.5px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-accent text-sa-void font-bold shadow-glow-cyan disabled:opacity-60 hover:brightness-110 transition-all"
              >
                {savingPlan ? 'Saving…' : 'Save plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {managingRow && (
        <ManageBillingModal
          row={managingRow}
          plans={plans ?? []}
          onClose={() => setManagingAdminId(null)}
          onChanged={() => {
            void loadOverview();
            void loadRevenue();
          }}
        />
      )}
    </div>
  );
}

function ManageBillingModal({
  row,
  plans,
  onClose,
  onChanged,
}: {
  row: AdminBillingOverviewRow;
  plans: BillingPlan[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [invoices, setInvoices] = useState<BillingInvoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [creditAmount, setCreditAmount] = useState('10');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceNote, setInvoiceNote] = useState('');
  const [suspendReason, setSuspendReason] = useState('');

  const loadDetail = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getAdminBillingDetail(row.admin.id);
      setInvoices(data.invoices);
    } catch {
      toast.error('Failed to load invoice history');
    }
  }, [row.admin.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const assignPlan = async (planId: string) => {
    setBusy(true);
    try {
      await superAdminApi.assignBillingPlan(row.admin.id, planId);
      toast.success('Plan reassigned');
      onChanged();
    } catch {
      toast.error('Failed to assign plan');
    } finally {
      setBusy(false);
    }
  };

  const suspend = async () => {
    setBusy(true);
    try {
      await superAdminApi.suspendAdminBilling(row.admin.id, suspendReason || undefined);
      toast.success('Admin suspended');
      onChanged();
      onClose();
    } catch {
      toast.error('Failed to suspend admin');
    } finally {
      setBusy(false);
    }
  };

  const reactivate = async () => {
    setBusy(true);
    try {
      await superAdminApi.reactivateAdminBilling(row.admin.id);
      toast.success('Admin reactivated');
      onChanged();
      onClose();
    } catch {
      toast.error('Failed to reactivate admin');
    } finally {
      setBusy(false);
    }
  };

  const addCredits = async () => {
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount === 0) return;
    setBusy(true);
    try {
      await superAdminApi.addAddOnCredits(row.admin.id, amount);
      toast.success(`${amount > 0 ? 'Added' : 'Removed'} ${Math.abs(amount)} AI generation credit(s)`);
      onChanged();
    } catch {
      toast.error('Failed to update credits');
    } finally {
      setBusy(false);
    }
  };

  const addInvoice = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(invoiceAmount);
    if (!Number.isFinite(amount)) return;
    setBusy(true);
    try {
      await superAdminApi.createManualInvoice(row.admin.id, { amount, status: 'manual', note: invoiceNote || undefined });
      toast.success('Invoice recorded');
      setInvoiceAmount('');
      setInvoiceNote('');
      void loadDetail();
    } catch {
      toast.error('Failed to record invoice');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className="relative w-full max-w-xl bg-sa-panel-raised border border-sa-accent/40 rounded-sm p-6 shadow-[0_0_50px_rgba(0,240,255,0.12)] max-h-[88vh] overflow-y-auto">
        <span className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-sa-accent to-transparent" />
        <h2 className="font-mono text-sm font-semibold text-sa-ink uppercase tracking-wide mb-1">{row.admin.name}</h2>
        <p className="font-mono text-[11.5px] text-sa-ink-faint mb-5">{row.admin.email}</p>

        <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Plan</label>
        <select
          value={row.plan.id}
          disabled={busy}
          onChange={(e) => void assignPlan(e.target.value)}
          className="w-full mb-4 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
        >
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5 flex items-center gap-1">
              <Sparkles size={11} /> AI credits (+/-)
            </label>
            <div className="flex gap-1.5">
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-sm text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
              />
              <button
                onClick={() => void addCredits()}
                disabled={busy}
                className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-sa-accent border border-sa-accent/40 rounded-sm px-2.5 hover:shadow-glow-cyan-sm transition-all disabled:opacity-50"
              >
                Apply
              </button>
            </div>
            <p className="text-[10.5px] text-sa-ink-faint mt-1">Current add-on: {row.billing.addOnAiGenerations}</p>
          </div>

          <div>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
              Account status
            </label>
            {row.billing.status === 'suspended' ? (
              <button
                onClick={() => void reactivate()}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 font-mono text-[11.5px] uppercase tracking-wide text-sa-good border border-sa-good/40 rounded-sm px-2.5 py-2 hover:shadow-glow-green transition-all disabled:opacity-50"
              >
                <RotateCcw size={13} /> Reactivate
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input
                  placeholder="Reason (optional)"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-critical transition-all font-mono"
                />
                <button
                  onClick={() => void suspend()}
                  disabled={busy}
                  className="shrink-0 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-sa-critical border border-sa-critical/40 rounded-sm px-2.5 hover:shadow-glow-red transition-all disabled:opacity-50"
                >
                  <Ban size={13} /> Suspend
                </button>
              </div>
            )}
          </div>
        </div>

        <h3 className="font-mono text-[11px] tracking-[0.1em] uppercase text-sa-ink-faint mb-2 flex items-center gap-1.5">
          <Receipt size={12} /> Invoices
        </h3>
        <div className="border border-sa-line rounded-sm mb-3 max-h-32 overflow-y-auto">
          {invoices === null && <div className="p-3 text-[12px] text-sa-ink-faint font-mono">Loading…</div>}
          {invoices?.length === 0 && <div className="p-3 text-[12px] text-sa-ink-faint font-mono">No invoices recorded.</div>}
          {invoices?.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between px-3 py-2 border-b border-sa-line-soft last:border-0 text-[12px]">
              <span className="font-mono text-sa-ink">
                {inv.currency} {inv.amount.toFixed(2)}
              </span>
              <StatusPill tone={inv.status === 'paid' ? 'good' : inv.status === 'failed' ? 'critical' : 'dim'}>
                {inv.status}
              </StatusPill>
              <span className="font-mono text-sa-ink-faint">{new Date(inv.issuedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>

        <form onSubmit={addInvoice} className="flex gap-1.5 mb-5">
          <input
            type="number"
            step="0.01"
            required
            placeholder="Amount"
            value={invoiceAmount}
            onChange={(e) => setInvoiceAmount(e.target.value)}
            className="w-24 bg-sa-panel-inset border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
          />
          <input
            placeholder="Note (optional)"
            value={invoiceNote}
            onChange={(e) => setInvoiceNote(e.target.value)}
            className="flex-1 bg-sa-panel-inset border border-sa-line rounded-sm px-2.5 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent transition-all font-mono"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-sa-accent border border-sa-accent/40 rounded-sm px-2.5 hover:shadow-glow-cyan-sm transition-all disabled:opacity-50"
          >
            Record
          </button>
        </form>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="font-mono text-[12.5px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-line text-sa-ink-dim hover:border-sa-line-bright transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
