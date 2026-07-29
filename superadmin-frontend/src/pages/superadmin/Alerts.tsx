import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { toast } from 'react-hot-toast';
import { Send } from 'lucide-react';
import { superAdminApi, type AlertConfigSettings, type AlertLogEntry } from '../../services/superAdminApi';
import { Card, StatusPill, EmptyState, PageHeader, Toggle, relativeTime } from './components';

export default function SuperAdminAlerts() {
  const [config, setConfig] = useState<AlertConfigSettings | null>(null);
  const [alerts, setAlerts] = useState<AlertLogEntry[] | null>(null);
  const [form, setForm] = useState({
    emailTo: '',
    slackWebhookUrl: '',
    genericWebhookUrl: '',
    apiLatencyP95ThresholdMs: '',
    sustainedMinutes: '5',
  });

  const loadConfig = useCallback(async () => {
    try {
      const { data } = await superAdminApi.getAlertConfig();
      setConfig(data.config);
      setForm({
        emailTo: data.config.emailTo ?? '',
        slackWebhookUrl: data.config.slackWebhookUrl ?? '',
        genericWebhookUrl: data.config.genericWebhookUrl ?? '',
        apiLatencyP95ThresholdMs: data.config.apiLatencyP95ThresholdMs?.toString() ?? '',
        sustainedMinutes: String(data.config.sustainedMinutes),
      });
    } catch {
      toast.error('Failed to load alert configuration');
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listAlerts({ limit: 100 });
      setAlerts(data.entries);
    } catch {
      toast.error('Failed to load alert history');
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadAlerts();
    const interval = setInterval(() => void loadAlerts(), 20000);
    return () => clearInterval(interval);
  }, [loadConfig, loadAlerts]);

  const toggleEnabled = async (enabled: boolean) => {
    try {
      const { data } = await superAdminApi.updateAlertConfig({ enabled });
      setConfig(data.config);
      toast.success(enabled ? 'Alerting enabled' : 'Alerting disabled');
    } catch {
      toast.error('Failed to update');
    }
  };

  const saveChannels = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { data } = await superAdminApi.updateAlertConfig({
        emailTo: form.emailTo || null,
        slackWebhookUrl: form.slackWebhookUrl || null,
        genericWebhookUrl: form.genericWebhookUrl || null,
        apiLatencyP95ThresholdMs: form.apiLatencyP95ThresholdMs ? Number(form.apiLatencyP95ThresholdMs) : null,
        sustainedMinutes: Number(form.sustainedMinutes) || 5,
      });
      setConfig(data.config);
      toast.success('Alert configuration saved');
    } catch {
      toast.error('Failed to save configuration');
    }
  };

  const sendTest = async () => {
    try {
      await superAdminApi.sendTestAlert();
      toast.success('Test alert dispatched');
      void loadAlerts();
    } catch {
      toast.error('Failed to send test alert');
    }
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Push notifications for mass deletes, bulk exports, repeated failed logins, feature-lock trips, sustained latency spikes, and anomaly auto-locks."
      />

      <Card className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-sa-ink tracking-wide uppercase font-mono mb-1">Alert delivery</h3>
          <p className="text-[12.5px] text-sa-ink-dim">Every alert is always recorded below; this only controls channel delivery.</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill tone={config?.enabled ? 'good' : 'dim'}>{config?.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
          <Toggle on={!!config?.enabled} onClick={() => void toggleEnabled(!config?.enabled)} label="Toggle alert delivery" />
        </div>
      </Card>

      <Card title="Channels" className="mb-4">
        <form onSubmit={saveChannels} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Email to</label>
            <input
              type="email"
              placeholder="ops@yourcompany.com"
              value={form.emailTo}
              onChange={(e) => setForm((f) => ({ ...f, emailTo: e.target.value }))}
              className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
            />
          </div>
          <div className="col-span-2">
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Slack webhook URL</label>
            <input
              placeholder="https://hooks.slack.com/services/…"
              value={form.slackWebhookUrl}
              onChange={(e) => setForm((f) => ({ ...f, slackWebhookUrl: e.target.value }))}
              className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
            />
          </div>
          <div className="col-span-2">
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Generic webhook URL</label>
            <input
              placeholder="https://your-receiver.example.com/hook"
              value={form.genericWebhookUrl}
              onChange={(e) => setForm((f) => ({ ...f, genericWebhookUrl: e.target.value }))}
              className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
            />
          </div>
          <div>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">
              API latency p95 threshold (ms)
            </label>
            <input
              type="number"
              placeholder="blank = disabled"
              value={form.apiLatencyP95ThresholdMs}
              onChange={(e) => setForm((f) => ({ ...f, apiLatencyP95ThresholdMs: e.target.value }))}
              className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
            />
          </div>
          <div>
            <label className="block font-mono text-[10.5px] tracking-[0.1em] uppercase text-sa-ink-dim mb-1.5">Sustained minutes</label>
            <input
              type="number"
              min={1}
              value={form.sustainedMinutes}
              onChange={(e) => setForm((f) => ({ ...f, sustainedMinutes: e.target.value }))}
              className="w-full bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2 text-[12.5px] text-sa-ink outline-none focus:border-sa-accent font-mono"
            />
          </div>
          <div className="col-span-2 flex gap-2">
            <button
              type="submit"
              className="font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm bg-sa-accent text-sa-void font-bold shadow-glow-cyan transition-all"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void sendTest()}
              className="inline-flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wide px-3.5 py-2 rounded-sm border border-sa-line text-sa-ink-dim hover:border-sa-line-bright transition-all"
            >
              <Send size={13} /> Send test alert
            </button>
          </div>
        </form>
      </Card>

      <Card title="Alert history" meta={alerts ? `${alerts.length} shown` : undefined}>
        <div className="space-y-1.5">
          {alerts?.map((alert) => (
            <div key={alert.id} className="flex items-start justify-between gap-3 bg-sa-panel-inset border border-sa-line rounded-sm px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <StatusPill tone={alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warn' : 'dim'}>
                    {alert.severity}
                  </StatusPill>
                  <span className="font-mono text-[11px] text-sa-ink-faint uppercase tracking-wide">{alert.type}</span>
                </div>
                <p className="text-[12.5px] text-sa-ink truncate">{alert.message}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[11px] text-sa-ink-faint">{relativeTime(alert.createdAt)}</div>
                <div className={`font-mono text-[10.5px] ${alert.delivered ? 'text-sa-good' : 'text-sa-ink-faint'}`}>
                  {alert.delivered ? 'delivered' : 'logged only'}
                </div>
              </div>
            </div>
          ))}
          {alerts?.length === 0 && <EmptyState>No alerts yet.</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
