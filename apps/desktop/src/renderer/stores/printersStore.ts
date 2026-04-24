import { create } from 'zustand';
import type { Printer } from '@appname/shared';

interface PrintersStore {
  printers: Printer[];
  selectedIds: Set<string>;
  setAll: (p: Printer[]) => void;
  toggle: (id: string) => void;
  clearSelection: () => void;
}

export const usePrintersStore = create<PrintersStore>((set) => ({
  printers: [],
  selectedIds: new Set(),
  setAll: (p) => set({ printers: p }),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  clearSelection: () => set({ selectedIds: new Set() }),
}));
