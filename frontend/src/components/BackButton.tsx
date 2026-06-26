import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BackButton({ mt = '4px' }: { mt?: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(-1)}
      title="Go back"
      className="back-circle-btn"
      style={{ marginTop: mt }}
    >
      <ArrowLeft width={15} height={15} stroke="currentColor" strokeWidth={2} />
    </button>
  );
}
