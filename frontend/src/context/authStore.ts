import { create } from 'zustand';
import { Admin, Candidate } from '../types';

interface AuthState {
  admin: Admin | null;
  candidate: Candidate | null;
  isAdminAuthenticated: boolean;
  isCandidateAuthenticated: boolean;
  setAdmin: (admin: Admin | null, token?: string, remember?: boolean) => void;
  setCandidate: (candidate: Candidate | null, token?: string) => void;
  logoutAdmin: () => void;
  logoutCandidate: () => void;
}

// "Remember me" controls whether the admin session survives closing the
// browser (localStorage) or ends with the tab/browser (sessionStorage).
// Reads/clears check both so an existing session works regardless of which
// one it was written to.
function getAdminStorage(): Storage {
  return sessionStorage.getItem('adminToken') ? sessionStorage : localStorage;
}

export function getAdminToken(): string | null {
  return localStorage.getItem('adminToken') || sessionStorage.getItem('adminToken');
}

function clearAdminStorage() {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminUser');
  sessionStorage.removeItem('adminToken');
  sessionStorage.removeItem('adminUser');
}

const storedAdmin = (() => {
  try {
    const raw = localStorage.getItem('adminUser') || sessionStorage.getItem('adminUser');
    return raw ? (JSON.parse(raw) as Admin) : null;
  } catch {
    return null;
  }
})();

export const useAuthStore = create<AuthState>((set) => ({
  admin: storedAdmin,
  candidate: null,
  isAdminAuthenticated: !!getAdminToken(),
  isCandidateAuthenticated: !!localStorage.getItem('candidateToken'),

  setAdmin: (admin, token, remember) => {
    const storage = remember === undefined ? getAdminStorage() : (remember ? localStorage : sessionStorage);
    if (token) {
      clearAdminStorage();
      storage.setItem('adminToken', token);
    }
    if (admin) {
      storage.setItem('adminUser', JSON.stringify(admin));
    } else {
      clearAdminStorage();
    }
    set({ admin, isAdminAuthenticated: !!admin });
  },

  setCandidate: (candidate, token) => {
    if (token) {
      localStorage.setItem('candidateToken', token);
    }
    set({ candidate, isCandidateAuthenticated: !!candidate });
  },

  logoutAdmin: () => {
    clearAdminStorage();
    set({ admin: null, isAdminAuthenticated: false });
  },

  logoutCandidate: () => {
    localStorage.removeItem('candidateToken');
    set({ candidate: null, isCandidateAuthenticated: false });
  }
}));
