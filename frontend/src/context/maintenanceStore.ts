import { create } from 'zustand';

interface MaintenanceState {
  active: boolean;
  message: string;
  setMaintenance: (active: boolean, message?: string) => void;
}

const DEFAULT_MESSAGE = 'The platform is temporarily down for maintenance. Please try again shortly.';

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  active: false,
  message: DEFAULT_MESSAGE,
  setMaintenance: (active, message) =>
    set({ active, message: active ? message || DEFAULT_MESSAGE : DEFAULT_MESSAGE }),
}));
