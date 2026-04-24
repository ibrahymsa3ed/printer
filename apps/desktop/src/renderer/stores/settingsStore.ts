import { create } from 'zustand';
import type { PrintSettings } from '@appname/shared';
import type { AppLanguage } from '../i18n';

interface SettingsStore {
  language: AppLanguage;
  arabicDigits: boolean;
  bookletEnabled: boolean;
  copies: number;
  printSettings: PrintSettings;
  setLanguage: (l: AppLanguage) => void;
  setArabicDigits: (v: boolean) => void;
  setBookletEnabled: (v: boolean) => void;
  setCopies: (n: number) => void;
  setPrintSettings: (patch: Partial<PrintSettings>) => void;
}

const defaultPrintSettings: PrintSettings = {
  copies: 1,
  pageRange: 'all',
  colorMode: 'mono',
  orientation: 'portrait',
  paperSize: 'A4',
  duplex: 'none',
  collate: true,
  fitToPage: true,
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  language: 'ar',
  arabicDigits: false,
  bookletEnabled: false,
  copies: 1,
  printSettings: defaultPrintSettings,
  setLanguage: (l) => set({ language: l }),
  setArabicDigits: (v) => set({ arabicDigits: v }),
  setBookletEnabled: (v) => set({ bookletEnabled: v }),
  setCopies: (n) => set({ copies: Math.max(1, Math.floor(n)) }),
  setPrintSettings: (patch) =>
    set((s) => ({ printSettings: { ...s.printSettings, ...patch } })),
}));
