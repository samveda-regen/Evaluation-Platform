import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { superAdminApi, type CompanyStorageRow } from '../../services/superAdminApi';
import { Card, EmptyState, PageHeader } from './components';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default function SuperAdminStorage() {
  const [companies, setCompanies] = useState<CompanyStorageRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listCompanyStorage();
      setCompanies(data.companies);
    } catch {
      toast.error('Failed to load storage usage');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalBytes = companies?.reduce((sum, c) => sum + c.totalBytes, 0) ?? 0;

  return (
    <div>
      <PageHeader
        title="Storage"
        description="Raw storage usage per company — proctoring recordings, snapshots, ID documents, and question-bank media. No cost figure is shown; nothing in this platform is wired to a real billing API for storage."
      />

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
