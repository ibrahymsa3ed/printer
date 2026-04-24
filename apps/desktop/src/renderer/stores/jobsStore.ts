import { create } from 'zustand';
import type { ChildJobStatus, Job, JobStatus } from '@appname/shared';

interface JobsStore {
  jobs: Job[];
  upsert: (job: Job) => void;
  updateStatus: (jobId: string, status: JobStatus) => void;
  updateChildStatus: (
    jobId: string,
    childId: string,
    status: ChildJobStatus,
    error?: string | null,
  ) => void;
  updateProgress: (jobId: string, progress: number) => void;
}

export const useJobsStore = create<JobsStore>((set) => ({
  jobs: [],
  upsert: (job) =>
    set((s) => {
      const idx = s.jobs.findIndex((j) => j.id === job.id);
      if (idx === -1) return { jobs: [job, ...s.jobs] };
      const copy = s.jobs.slice();
      copy[idx] = job;
      return { jobs: copy };
    }),
  updateStatus: (jobId, status) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, status } : j)),
    })),
  updateChildStatus: (jobId, childId, status, error) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? {
              ...j,
              children: j.children.map((c) =>
                c.id === childId ? { ...c, status, error: error ?? c.error } : c,
              ),
            }
          : j,
      ),
    })),
  updateProgress: (jobId, progress) =>
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, progress } : j)),
    })),
}));
