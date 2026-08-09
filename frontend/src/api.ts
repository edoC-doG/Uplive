export interface VideoRecord {
  id: string;
  url: string;
  status: 'queued' | 'downloading' | 'ready' | 'error';
  duration?: number;
  width?: number;
  height?: number;
  error?: string;
  progress?: number;
}

export type TransitionType = 'cut' | 'fade' | 'slide';

export interface JobRecord {
  id: string;
  videoId: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress?: number;
  error?: string;
  downloadUrl?: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return body.data as T;
}

export const api = {
  createVideo: (url: string) =>
    fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => unwrap<{ id: string }>(r)),

  getVideo: (id: string) => fetch(`/api/videos/${id}`).then((r) => unwrap<VideoRecord>(r)),

  createExport: (videoId: string, clips: { start: number; end: number }[], transitions: TransitionType[]) =>
    fetch(`/api/videos/${videoId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clips, transitions }),
    }).then((r) => unwrap<{ jobId: string }>(r)),

  getJob: (id: string) => fetch(`/api/jobs/${id}`).then((r) => unwrap<JobRecord>(r)),
};
