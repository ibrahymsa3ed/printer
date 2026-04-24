import { create } from 'zustand';
import type { FileEntry } from '@appname/shared';

interface FilesStore {
  files: FileEntry[];
  add: (entries: FileEntry[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useFilesStore = create<FilesStore>((set) => ({
  files: [],
  add: (entries) => set((s) => ({ files: [...s.files, ...entries] })),
  remove: (id) => set((s) => ({ files: s.files.filter((f) => f.id !== id) })),
  clear: () => set({ files: [] }),
}));
