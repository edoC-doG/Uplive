export type VideoStatus = 'queued' | 'downloading' | 'ready' | 'error';

export interface VideoRecord {
  id: string;
  url: string;
  status: VideoStatus;
  title?: string;
  duration?: number;
  width?: number;
  height?: number;
  filePath?: string;
  error?: string;
  progress?: number;
  createdAt: number;
}

export type TransitionType = 'cut' | 'fade' | 'slide';

export interface ClipSelection {
  start: number;
  end: number;
}

export interface ExportRequestBody {
  clips: ClipSelection[];
  transitions: TransitionType[];
}

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export interface JobRecord {
  id: string;
  videoId: string;
  status: JobStatus;
  progress?: number;
  outputPath?: string;
  error?: string;
  createdAt: number;
  request: ExportRequestBody;
}
