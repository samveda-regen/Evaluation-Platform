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

export const useAuthStore = create<AuthState>((set) => ({
  admin: null,
  candidate: null,
  isAdminAuthenticated: !!localStorage.getItem('adminToken'),
  isCandidateAuthenticated: !!localStorage.getItem('candidateToken'),

  setAdmin: (admin, token) => {
    if (token) {
      localStorage.setItem('adminToken', token);
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
    set({ admin: null, isAdminAuthenticated: false });
  },

  logoutCandidate: () => {
    localStorage.removeItem('candidateToken');
    set({ candidate: null, isCandidateAuthenticated: false });
  }
}));
