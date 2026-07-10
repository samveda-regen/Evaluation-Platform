import { create } from 'zustand';
import type { SuperAdmin } from '../services/superAdminApi';

interface SuperAdminAuthState {
  superAdmin: SuperAdmin | null;
  isSuperAdminAuthenticated: boolean;
  setSuperAdmin: (superAdmin: SuperAdmin | null, token?: string) => void;
  logout: () => void;
}

const storedSuperAdmin = (() => {
  try {
    const raw = localStorage.getItem('superAdminUser');
    return raw ? (JSON.parse(raw) as SuperAdmin) : null;
  } catch {
    return null;
  }
})();

export const useSuperAdminStore = create<SuperAdminAuthState>((set) => ({
  superAdmin: storedSuperAdmin,
  isSuperAdminAuthenticated: !!localStorage.getItem('superAdminToken'),

  setSuperAdmin: (superAdmin, token) => {
    if (token) {
      localStorage.setItem('superAdminToken', token);
    }
    if (superAdmin) {
      localStorage.setItem('superAdminUser', JSON.stringify(superAdmin));
    } else {
      localStorage.removeItem('superAdminUser');
    }
    set({ superAdmin, isSuperAdminAuthenticated: !!superAdmin });
  },

  logout: () => {
    localStorage.removeItem('superAdminToken');
    localStorage.removeItem('superAdminUser');
    set({ superAdmin: null, isSuperAdminAuthenticated: false });
  },
}));
