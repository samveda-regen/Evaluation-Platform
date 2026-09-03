import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { HardDrive, RefreshCw } from 'lucide-react';
import { superAdminApi, type CompanyStorageRow, type B2StorageAnalytics } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader, StatCard, relativeTime } from './components';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

const TYPE_LABELS: Record<string, string> = {
  recording: 'Recordings',
  snapshot: 'Snapshots',
  metadata: 'Metadata sidecars',
  other: 'Other',
};

export default function SuperAdminStorage() {
  const [companies, setCompanies] = useState<CompanyStorageRow[] | null>(null);
  const [b2, setB2] = useState<B2StorageAnalytics | null>(null);
  const [b2Loading, setB2Loading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listCompanyStorage();
      setCompanies(data.companies);
    } catch {
      toast.error('Failed to load storage usage');
    }
  }, []);

  const loadB2 = useCallback(async (refresh = false) => {
    setB2Loading(true);
    try {
      const { data } = await superAdminApi.getB2StorageAnalytics(refresh);
      setB2(data);
      if (refresh) toast.success('Bucket analytics refreshed');
    } catch {
      toast.error('Failed to read bucket analytics from B2');
    } finally {
      setB2Loading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadB2();
  }, [load, loadB2]);

  const totalBytes = companies?.reduce((sum, c) => sum + c.totalBytes, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Storage"
        description="Per-company usage is a rollup of Postgres file metadata (fileSize columns). Backblaze B2 analytics below is a live scan of the actual bucket — the two figures should track each other once all artifacts are B2-backed."
      />

      {b2 && b2.configured && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[13px] font-semibold text-sa-ink flex items-center gap-2">
              <HardDrive size={15} className="text-sa-ink-dim" />
              Backblaze B2 — <span className="text-sa-ink-dim font-normal">{b2.bucket}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadB2(true)}
              disabled={b2Loading}
              className="inline-flex items-center gap-1.5 text-[12px] text-sa-ink-dim hover:text-sa-ink border border-sa-line rounded-lg px-2.5 py-1.5 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={12} className={b2Loading ? 'animate-spin' : ''} />
              Rescan
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard label="Bucket total" value={formatBytes(b2.totalBytes ?? 0)} sub={`${(b2.totalObjects ?? 0).toLocaleString()} objects`} icon={HardDrive} />
            {(b2.byType ?? []).map((t) => (
              <StatCard
                key={t.type}
                label={TYPE_LABELS[t.type] ?? t.type}
                value={formatBytes(t.bytes)}
                sub={`${t.objects.toLocaleString()} objects`}
                tone={t.type === 'recording' ? 'accent' : t.type === 'snapshot' ? 'teal' : 'default'}
              />
            ))}
          </div>

          <div className="text-[11px] text-sa-ink-faint mb-4">
            {b2.cached
              ? `Cached scan from ${relativeTime(b2.generatedAt)} — rescans every 5 min or on demand.`
              : `Fresh scan just now.`}
            {b2.truncated && ' Scan hit its object cap; totals are a lower bound.'}
          </div>

          {(b2.topFolders?.length ?? 0) > 0 && (
            <Card className="p-0 overflow-hidden mb-4" title="Top assessment folders by size">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-sa-line text-left">
                      {['Folder (testName_testId)', 'Objects', 'Size'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b2.topFolders!.map((f) => (
                      <tr key={f.folder} className="border-b border-sa-line-soft last:border-0">
                        <td className="px-4 py-2.5 text-sa-ink font-mono text-[12px] truncate max-w-[420px]">{f.folder}</td>
                        <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{f.objects.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-[12px] font-semibold text-sa-ink">{formatBytes(f.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {(b2.largestObjects?.length ?? 0) > 0 && (
            <Card className="p-0 overflow-hidden" title="Largest objects">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-sa-line text-left">
                      {['Key', 'Last modified', 'Size'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b2.largestObjects!.map((o) => (
                      <tr key={o.key} className="border-b border-sa-line-soft last:border-0">
                        <td className="px-4 py-2.5 text-sa-ink font-mono text-[11px] truncate max-w-[460px]">{o.key}</td>
                        <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{relativeTime(o.lastModified)}</td>
                        <td className="px-4 py-2.5 text-[12px] font-semibold text-sa-ink">{formatBytes(o.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {b2 && !b2.configured && (
        <Card className="mb-6" title="Backblaze B2">
          <p className="text-[13px] text-sa-ink-dim">
            No S3 bucket configured (<span className="font-mono text-[12px]">EGRESS_S3_*</span> env vars are unset). Recordings and
            snapshots are stored on local disk or in Postgres. Set the bucket credentials to enable live B2 analytics here.
          </p>
        </Card>
      )}

      <Card className="p-0 overflow-hidden" title="Companies by storage used" meta={companies ? formatBytes(totalBytes) + ' total' : undefined}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-sa-line text-left">
                {['Company', 'Recordings', 'Snapshots / documents', 'Question-bank media', 'Total'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies?.map((c) => (
                <tr key={c.companyId} className="border-b border-sa-line-soft last:border-0">
                  <td className="px-4 py-2.5 text-sa-ink">{c.companyName}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{formatBytes(c.recordingBytes)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{formatBytes(c.fileStorageBytes)}</td>
                  <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{formatBytes(c.mediaBytes)}</td>
                  <td className="px-4 py-2.5 text-[12px] font-semibold text-sa-ink">{formatBytes(c.totalBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {companies?.length === 0 && <EmptyState>No companies yet.</EmptyState>}
          {companies === null && <EmptyState>Loading…</EmptyState>}
        </div>
      </Card>
    </div>
  );
}
