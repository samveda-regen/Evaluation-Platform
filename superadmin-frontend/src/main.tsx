import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
    <Toaster
      position="top-right"
      gutter={12}
      containerStyle={{ zIndex: 99999, top: 20, right: 22 }}
      toastOptions={{
        duration: 5200,
        style: {
          minWidth: '320px',
          maxWidth: '520px',
          padding: '14px 16px',
          borderRadius: '2px',
          border: '1px solid #241B3D',
          background: '#0D0A18',
          color: '#EAF6FF',
          fontSize: '13px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        },
        success: { iconTheme: { primary: '#39FF88', secondary: '#0D0A18' } },
        error: { iconTheme: { primary: '#FF2E63', secondary: '#0D0A18' } },
      }}
    />
  </BrowserRouter>
);
