import { Fragment, useEffect, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Pencil, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { superAdminApi, type CompanySummary, type CompanyAdminRow } from '../../services/superAdminApi';
import { Card, StatusPill, EmptyState, PageHeader, relativeTime } from './components';

export default function SuperAdminCompanies() {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedAdmins, setExpandedAdmins] = useState<CompanyAdminRow[] | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await superAdminApi.listCompanies();
      setCompanies(data.companies);
    } catch {
      toast.error('Failed to load companies');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (company: CompanySummary) => {
    setEditingId(company.id);
    setEditingName(company.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = async (companyId: string) => {
    if (!editingName.trim()) {
      toast.error('Company name cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await superAdminApi.renameCompany(companyId, editingName.trim());
      toast.success('Company renamed');
      setEditingId(null);
      setEditingName('');
      void load();
    } catch {
      toast.error('Failed to rename company');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = async (company: CompanySummary) => {
    if (expandedId === company.id) {
      setExpandedId(null);
      setExpandedAdmins(null);
      return;
    }
    setExpandedId(company.id);
    setExpandedAdmins(null);
    try {
      const { data } = await superAdminApi.getCompanyDetail(company.id);
      setExpandedAdmins(data.admins);
    } catch {
      toast.error('Failed to load company admins');
    }
  };

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Every company on the platform. Admins are shared company-wide, so this is where their tests and account counts actually live."
      />

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-sa-line text-left">
                {['Company', 'Admins', 'Tests', 'Candidates', 'Created', ''].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] text-sa-ink-faint font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies?.map((company) => (
                <Fragment key={company.id}>
                  <tr className="border-b border-sa-line-soft last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void toggleExpand(company)}
                          className="p-0.5 text-sa-ink-faint hover:text-sa-accent transition-colors"
                          title="Show admins"
                        >
                          {expandedId === company.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {editingId === company.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void saveEdit(company.id);
                                if (e.key === 'Escape') cancelEdit();
                              }}
                              className="text-[13px] text-sa-ink bg-sa-panel-inset border border-sa-accent/50 rounded px-2 py-1 outline-none"
                            />
                            <button
                              onClick={() => void saveEdit(company.id)}
                              disabled={saving}
                              className="p-1 text-sa-good hover:brightness-110 transition-all disabled:opacity-50"
                              title="Save"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="p-1 text-sa-ink-faint hover:text-sa-critical transition-colors disabled:opacity-50"
                              title="Cancel"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <div>
                              <div className="text-sa-ink">{company.name}</div>
                              <div className="text-[11px] text-sa-ink-faint">{company.externalCompanyId}</div>
                            </div>
                            <button
                              onClick={() => startEdit(company)}
                              className="p-1 text-sa-ink-faint hover:text-sa-accent transition-colors"
                              title="Rename company"
                            >
                              <Pencil size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{company.adminCount}</td>
                    <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{company.testCount}</td>
                    <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{company.candidateCount}</td>
                    <td className="px-4 py-2.5 text-[12px] text-sa-ink-dim">{relativeTime(company.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      {company.webhookConfigured && <StatusPill tone="good">Webhook configured</StatusPill>}
                    </td>
                  </tr>
                  {expandedId === company.id && (
                    <tr className="border-b border-sa-line-soft last:border-0 bg-sa-panel-inset">
                      <td colSpan={6} className="px-4 py-3">
                        {expandedAdmins === null ? (
                          <span className="text-[12px] text-sa-ink-faint">Loading admins…</span>
                        ) : expandedAdmins.length === 0 ? (
                          <span className="text-[12px] text-sa-ink-faint">No admins in this company yet.</span>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {expandedAdmins.map((admin) => (
                              <div key={admin.id} className="flex items-center gap-2.5">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    admin.status === 'online' ? 'bg-sa-good' : 'bg-sa-ink-faint'
                                  }`}
                                />
                                <span className="text-[12.5px] text-sa-ink">{admin.name}</span>
                                <span className="text-[11.5px] text-sa-ink-faint">{admin.email}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
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
