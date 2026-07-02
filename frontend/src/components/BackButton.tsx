import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BackButton({ mt = '4px', onClick }: { mt?: string; onClick?: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={onClick ?? (() => navigate(-1))}
      title="Go back"
      className="back-circle-btn"
      style={{ marginTop: mt }}
    >
      <ArrowLeft width={15} height={15} stroke="currentColor" strokeWidth={2} />
    </button>
  );
}
