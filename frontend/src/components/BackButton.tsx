import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BackButton({ mt = '4px' }: { mt?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(-1)}
      title="Go back"
      style={{
        width: '34px', height: '34px', borderRadius: '50%',
        border: '1.5px solid #E5E7EB', backgroundColor: 'white',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0, marginTop: mt,
        transition: 'background-color 0.18s, border-color 0.18s, transform 0.18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = '#F3F4F6';
        e.currentTarget.style.borderColor = '#9CA3AF';
        e.currentTarget.style.transform = 'scale(1.1)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'white';
        e.currentTarget.style.borderColor = '#E5E7EB';
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.93)'; }}
      onMouseUp={e => { e.currentTarget.style.transform = 'scale(1.1)'; }}
    >
      <ArrowLeft width={15} height={15} stroke="#6B7280" strokeWidth={2} />
    </button>
  );
}
