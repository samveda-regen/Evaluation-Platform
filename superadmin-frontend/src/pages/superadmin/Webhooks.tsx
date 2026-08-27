import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { RotateCw } from 'lucide-react';
import { superAdminApi, type WebhookDelivery, type CompanySummary } from '../../services/superAdminApi';
import { Card, StatusPill, EmptyState, PageHeader, Select, relativeTime } from './components';

const ALL_COMPANIES = '__all__';
const ALL_STATUSES = '__all__';

export default function SuperAdminWebhooks() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>(ALL_COMPANIES);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listWebhookDeliveries({
        companyId: companyFilter === ALL_COMPANIES ? undefined : companyFilter,
        success: statusFilter === ALL_STATUSES ? undefined : (statusFilter as 'true' | 'false'),
      });
      setDeliveries(data.deliveries);
    } catch {
      toast.error('Failed to load webhook deliveries');
    }
  }, [companyFilter, statusFilter]);

  useEffect(() => {
    superAdminApi
      .listCompanies()
      .then(({ data }) => setCompanies(data.companies))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const retry = async (delivery: WebhookDelivery) => {
    setRetryingId(delivery.id);
    try {
      await superAdminApi.retryWebhookDelivery(delivery.id);
      toast.success(`Retried ${delivery.event} for ${delivery.companyName}`);
      void load();
    } catch {
      toast.error('Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Every attempted delivery of a company's configured webhook — invitation.sent, test.started, test.completed. Failed deliveries can be replayed from the stored payload."
      />

      <div className="flex items-center justify-end gap-2.5 mb-4">
        <Select
          value={companyFilter}
          onChange={setCompanyFilter}
          placeholder="All companies"
          options={[
            { value: ALL_COMPANIES, label: 'All companies' },
            ...(companies ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          options={[
            { value: ALL_STATUSES, label: 'All statuses' },
            { value: 'true', label: 'Success only' },
            { value: 'false', label: 'Failed only' },
          ]}
        />
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-sa-line text-left">
                {['Company', 'Event', 'Status', 'Duration', 'Attempt', 'When', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deliveries?.map((d) => (
                <tr key={d.id} className="border-b border-sa-line-soft last:border-0">
                  <td className="px-4 py-2.5 text-sa-ink">{d.companyName}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{d.event}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill tone={d.success ? 'good' : 'critical'}>
                      {d.success ? 'Delivered' : d.statusCode ? `Failed (${d.statusCode})` : 'Failed'}
                    </StatusPill>
                    {d.error && <div className="text-[11px] text-sa-ink-faint mt-0.5 max-w-[220px] truncate" title={d.error}>{d.error}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">
                    {d.durationMs !== null ? `${d.durationMs}ms` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{d.attempt}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{relativeTime(d.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    {!d.success && (
                      <button
                        onClick={() => void retry(d)}
                        disabled={retryingId === d.id}
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-sa-accent bg-sa-accent-soft border border-sa-accent/40 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-50"
                      >
                        <RotateCw size={13} className={retryingId === d.id ? 'animate-spin' : ''} /> Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {deliveries?.length === 0 && <EmptyState>No webhook deliveries yet.</EmptyState>}
          {deliveries === null && <EmptyState>Loading…</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
