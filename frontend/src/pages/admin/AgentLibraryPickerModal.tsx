import { useEffect, useState } from 'react';
import { X, Search } from 'lucide-react';
import { adminApi } from '../../services/api';
import type { LibraryPicks, PreviewEntry, SuggestionType } from './agentTestForm.types';

interface RawItem { id: string; text: string; difficulty: string; topic: string | null }

interface Props {
  allowedTypes: SuggestionType[];
  libraryPicks: LibraryPicks;
  getLimit: (type: SuggestionType) => number;
  getSelectedCount: (type: SuggestionType) => number;
  onTogglePick: (type: SuggestionType, preview: PreviewEntry) => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<SuggestionType, string> = {
  mcq: 'MCQ', coding: 'Coding', behavioral: 'Behavioral',
  written: 'Written', reading: 'Reading', speaking: 'Speaking',
};
const COMMUNICATION_SUB_TYPE: Partial<Record<SuggestionType, 'WRITTEN' | 'READING' | 'SPEAKING'>> = {
  written: 'WRITTEN', reading: 'READING', speaking: 'SPEAKING',
};
const PAGE_SIZE = 20;

export default function AgentLibraryPickerModal({ allowedTypes, libraryPicks, getLimit, getSelectedCount, onTogglePick, onClose }: Props) {
  const [activeType, setActiveType] = useState<SuggestionType>(allowedTypes[0] ?? 'mcq');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<RawItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => { setPage(1); }, [activeType, debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const communicationSubType = COMMUNICATION_SUB_TYPE[activeType];
        const { data } = activeType === 'mcq'
          ? await adminApi.getMCQs(page, PAGE_SIZE, debouncedSearch)
          : activeType === 'coding'
          ? await adminApi.getCodings(page, PAGE_SIZE, debouncedSearch)
          : activeType === 'behavioral'
          ? await adminApi.getBehaviorals(page, PAGE_SIZE, debouncedSearch)
          : await adminApi.getCommunications(page, PAGE_SIZE, debouncedSearch, communicationSubType);
        if (cancelled) return;
        const rawQuestions: Array<Record<string, unknown>> = data.questions || [];
        const mapped: RawItem[] = rawQuestions.map(q => {
          const passage = q.passage as { title?: string } | null | undefined;
          return {
            id: q.id as string,
            text: activeType === 'mcq'
              ? (q.questionText as string)
              : activeType === 'reading'
              ? `${passage?.title ? `${passage.title}: ` : ''}${q.title as string}`.slice(0, 200)
              : activeType === 'written' || activeType === 'speaking'
              ? `${q.title as string}${q.description ? `: ${q.description as string}` : ''}`.slice(0, 200)
              : `${q.title as string}: ${q.description as string}`.slice(0, 200),
            difficulty: (q.difficulty as string) || 'medium',
            topic: (q.topic as string | null) ?? null,
          };
        });
        setItems(mapped);
        setTotalPages(Math.max(1, data.pagination?.totalPages ?? 1));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeType, debouncedSearch, page]);

  const isSelected = (id: string) => libraryPicks[activeType].some(p => p.id === id && p.selected);
  const limit = getLimit(activeType);
  const selectedCount = getSelectedCount(activeType);

  return (
    <div className="ui-modal-backdrop" onClick={onClose}>
      <div className="ui-modal" style={{ maxWidth: '760px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--admin-text)', margin: 0 }}>Add from Library</h3>
            <p style={{ fontSize: '12px', color: 'var(--admin-text-subtle)', margin: '2px 0 0' }}>Search your question library and check any to add — still capped at the Step 2 limit.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-subtle)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--admin-border)', display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {allowedTypes.map(type => (
              <button key={type} type="button" onClick={() => setActiveType(type)}
                style={{
                  padding: '7px 14px', borderRadius: '999px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  border: `1.5px solid ${activeType === type ? 'var(--admin-accent)' : 'var(--admin-border)'}`,
                  backgroundColor: activeType === type ? 'var(--admin-accent-soft)' : 'white',
                  color: activeType === type ? 'var(--admin-accent-hover)' : 'var(--admin-text-muted)',
                }}
              >
                {TYPE_LABELS[type]}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 600, color: selectedCount >= limit ? 'var(--admin-accent-hover)' : 'var(--admin-text-subtle)', alignSelf: 'center' }}>
              {selectedCount} / {limit} selected
            </span>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--admin-text-subtle)' }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${TYPE_LABELS[activeType].toLowerCase()} questions…`}
              className="ui-field" style={{ paddingLeft: '34px' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 24px', minHeight: '260px' }}>
          {loading && <p style={{ fontSize: '13px', color: 'var(--admin-text-subtle)', margin: 0, textAlign: 'center', padding: '32px 0' }}>Loading…</p>}
          {!loading && items.length === 0 && (
            <p style={{ fontSize: '13px', color: 'var(--admin-text-subtle)', margin: 0, textAlign: 'center', padding: '32px 0' }}>
              No {TYPE_LABELS[activeType].toLowerCase()} questions found{debouncedSearch ? ` for "${debouncedSearch}"` : ''}.
            </p>
          )}
          {!loading && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map(item => {
                const selected = isSelected(item.id);
                const atLimit = !selected && selectedCount >= limit;
                return (
                  <label key={item.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', borderRadius: '8px',
                    border: `1.5px solid ${selected ? 'var(--admin-accent-disabled)' : 'var(--admin-border)'}`,
                    backgroundColor: selected ? 'var(--admin-accent-soft)' : 'white',
                    cursor: atLimit ? 'not-allowed' : 'pointer', opacity: atLimit ? 0.55 : 1,
                  }}>
                    <input type="checkbox" checked={selected} disabled={atLimit}
                      onChange={() => onTogglePick(activeType, { id: item.id, text: item.text, difficulty: item.difficulty, topic: item.topic })}
                      style={{ marginTop: '2px', width: '16px', height: '16px', cursor: atLimit ? 'not-allowed' : 'pointer', accentColor: 'var(--admin-button-primary)', flexShrink: 0 }}
                    />
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--admin-text)', lineHeight: '1.5' }}>{item.text}</span>
                    <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 600, color: 'var(--admin-text-subtle)', textTransform: 'capitalize' }}>{item.difficulty}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--admin-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--admin-border)', backgroundColor: 'white', fontSize: '13px', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>
              Prev
            </button>
            <span style={{ fontSize: '12px', color: 'var(--admin-text-subtle)' }}>Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--admin-border)', backgroundColor: 'white', fontSize: '13px', cursor: page >= totalPages ? 'not-allowed' : 'pointer', opacity: page >= totalPages ? 0.5 : 1 }}>
              Next
            </button>
          </div>
          <button type="button" onClick={onClose}
            style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid var(--admin-accent)', backgroundColor: 'var(--admin-accent)', color: 'white', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
