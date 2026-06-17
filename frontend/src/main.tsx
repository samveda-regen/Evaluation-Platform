import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

/* Number input fixes — prevents "0123" when typing into a field showing "0".
   Strategy: select-all on focus + intercept keydown when value is "0". */
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.type === 'number') {
    setTimeout(() => el.select(), 0);
  }
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (
    el instanceof HTMLInputElement &&
    el.type === 'number' &&
    /^[0-9]$/.test(e.key) &&
    (el.value === '0' || el.value === '')
  ) {
    el.select(); // select the "0" so the typed digit replaces it
  }
}, true); // capture phase so it runs before browser processes the keystroke

ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
    <Toaster position="top-right" />
  </BrowserRouter>
);
