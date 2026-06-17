import { create } from 'zustand';
import { Admin, Candidate } from '../types';

interface AuthState {
  admin: Admin | null;
  candidate: Candidate | null;
  isAdminAuthenticated: boolean;
  isCandidateAuthenticated: boolean;
  setAdmin: (admin: Admin | null, token?: string) => void;
  setCandidate: (candidate: Candidate | null, token?: string) => void;
  logoutAdmin: () => void;
  logoutCandidate: () => void;
}

const storedAdmin = (() => {
  try {
    const raw = localStorage.getItem('adminUser');
    return raw ? (JSON.parse(raw) as Admin) : null;
  } catch {
    return null;
  }
})();

export const useAuthStore = create<AuthState>((set) => ({
  admin: storedAdmin,
  candidate: null,
  isAdminAuthenticated: !!localStorage.getItem('adminToken'),
  isCandidateAuthenticated: !!localStorage.getItem('candidateToken'),

  setAdmin: (admin, token) => {
    if (token) {
      localStorage.setItem('adminToken', token);
    }
    if (admin) {
      localStorage.setItem('adminUser', JSON.stringify(admin));
    } else {
      localStorage.removeItem('adminUser');
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
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    set({ admin: null, isAdminAuthenticated: false });
  },

  logoutCandidate: () => {
    localStorage.removeItem('candidateToken');
    set({ candidate: null, isCandidateAuthenticated: false });
  }
}));
