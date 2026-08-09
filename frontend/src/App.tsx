import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock3, Download, Loader2, Plus, Scissors, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type JobRecord, type TransitionType, type VideoRecord } from './api';
import upliveIcon from './assets/icon.png';

interface ClipDraft {
  start: number;
  end: number;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-primary">{title}</h2>
      {children}
    </section>
  );
}

function StatusPill({ status, progress }: { status: string; progress?: number }) {
  const busy = status === 'downloading' || status === 'processing' || status === 'queued';
  const done = status === 'ready' || status === 'done';
  const failed = status === 'error';

  const classes = done
    ? 'bg-success/10 text-success border-success/30'
    : failed
      ? 'bg-destructive/10 text-destructive border-destructive/30'
      : 'bg-muted text-muted-foreground border-border';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${classes}`}>
      {done && <CheckCircle2 className="h-3.5 w-3.5" />}
      {failed && <XCircle className="h-3.5 w-3.5" />}
      {status === 'queued' && <Clock3 className="h-3.5 w-3.5" />}
      {(status === 'downloading' || status === 'processing') && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {status}
      {busy && progress !== undefined && progress > 0 ? ` · ${Math.round(progress)}%` : ''}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}

/** Accepts "m:ss.s" (e.g. "2:05.3") or plain seconds (e.g. "125.3"). Returns null if unparseable. */
function parseTimeInput(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(trimmed);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds >= 60) return null;
  return minutes * 60 + seconds;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [video, setVideo] = useState<VideoRecord | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);

  const [clips, setClips] = useState<ClipDraft[]>([]);
  const [transitions, setTransitions] = useState<TransitionType[]>([]);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  // Separate "draft" text state so the input can hold invalid/in-progress
  // text (e.g. "2:0") while typing, without fighting a controlled value
  // that's always reformatted from the numeric seconds.
  const [rangeStartText, setRangeStartText] = useState('0:00.0');
  const [rangeEndText, setRangeEndText] = useState('0:00.0');

  const [job, setJob] = useState<JobRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!video || video.status === 'ready' || video.status === 'error') return;
    const t = setInterval(async () => {
      try {
        const updated = await api.getVideo(video.id);
        setVideo(updated);
        if (updated.status === 'ready' && updated.duration) applyRangeEnd(updated.duration);
      } catch {
        clearInterval(t);
      }
    }, 1200);
    return () => clearInterval(t);
  }, [video]);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    const t = setInterval(async () => {
      const updated = await api.getJob(job.id);
      setJob(updated);
    }, 1200);
    return () => clearInterval(t);
  }, [job]);

  async function handleLoadVideo(e: React.FormEvent) {
    e.preventDefault();
    setVideoError(null);
    setVideo(null);
    setClips([]);
    setTransitions([]);
    setJob(null);
    setLoadingVideo(true);
    try {
      const created = await api.createVideo(url.trim());
      setVideo(await api.getVideo(created.id));
    } catch (err) {
      setVideoError((err as Error).message);
    } finally {
      setLoadingVideo(false);
    }
  }

  function addClip() {
    if (!video?.duration || rangeEnd <= rangeStart) return;
    const next = [...clips, { start: rangeStart, end: rangeEnd }];
    setClips(next);
    if (next.length > 1) setTransitions([...transitions, 'cut']);
  }

  function removeClip(index: number) {
    setClips(clips.filter((_, i) => i !== index));
    if (transitions.length > 0) {
      const cutIndex = index === 0 ? 0 : index - 1;
      setTransitions(transitions.filter((_, i) => i !== cutIndex));
    }
  }

  function moveClip(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= clips.length) return;
    const next = [...clips];
    [next[index], next[target]] = [next[target], next[index]];
    setClips(next);
  }

  function setTransition(index: number, type: TransitionType) {
    const next = [...transitions];
    next[index] = type;
    setTransitions(next);
  }

  function applyRangeStart(seconds: number) {
    setRangeStart(seconds);
    setRangeStartText(formatTime(seconds));
  }
  function applyRangeEnd(seconds: number) {
    setRangeEnd(seconds);
    setRangeEndText(formatTime(seconds));
  }
  function commitRangeStartText() {
    const parsed = parseTimeInput(rangeStartText);
    if (parsed !== null && parsed >= 0) applyRangeStart(parsed);
    else setRangeStartText(formatTime(rangeStart));
  }
  function commitRangeEndText() {
    const parsed = parseTimeInput(rangeEndText);
    if (parsed !== null && parsed >= 0) applyRangeEnd(parsed);
    else setRangeEndText(formatTime(rangeEnd));
  }

  async function handleExport() {
    if (!video || clips.length === 0) return;
    setSubmitting(true);
    setExportError(null);
    try {
      const created = await api.createExport(video.id, clips, transitions);
      setJob(await api.getJob(created.jobId));
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-10">
      <header className="mb-8 flex items-center gap-3">
        <img src={upliveIcon} alt="Uplive" className="h-8 w-auto shrink-0" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">ClipForge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a YouTube link, pick clips, add transitions, export.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-5">
        <SectionCard title="1. Load a video">
          <form onSubmit={handleLoadVideo} className="flex gap-2">
            <Input
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <Button type="submit" disabled={!url.trim() || loadingVideo}>
              {loadingVideo ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
            </Button>
          </form>
          {videoError && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{videoError}</AlertDescription>
            </Alert>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Capped at 15 min / 480p / 200MB for this prototype.
          </p>
        </SectionCard>

        {video && (
          <SectionCard title="2. Pick clips">
            <div className="mb-3 flex items-center justify-between">
              <StatusPill status={video.status} progress={video.progress} />
              {video.duration ? (
                <span className="text-xs text-muted-foreground">{formatTime(video.duration)} total</span>
              ) : null}
            </div>

            {(video.status === 'queued' || video.status === 'downloading') && (
              <div className="space-y-2">
                <Skeleton className="h-48 w-full" />
                <ProgressBar value={video.progress ?? 0} />
              </div>
            )}

            {video.status === 'error' && (
              <Alert variant="destructive">
                <AlertDescription>{video.error}</AlertDescription>
              </Alert>
            )}

            {video.status === 'ready' && video.duration ? (
              <div className="space-y-4">
                <video
                  ref={videoRef}
                  src={`/api/videos/${video.id}/source`}
                  controls
                  className="w-full rounded-md border border-border bg-black"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Start</Label>
                    <div className="flex gap-1.5">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0:00.0"
                        value={rangeStartText}
                        onChange={(e) => setRangeStartText(e.target.value)}
                        onBlur={commitRangeStartText}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyRangeStart(videoRef.current?.currentTime ?? 0)}
                      >
                        Use time
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>End</Label>
                    <div className="flex gap-1.5">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0:00.0"
                        value={rangeEndText}
                        onChange={(e) => setRangeEndText(e.target.value)}
                        onBlur={commitRangeEndText}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => applyRangeEnd(videoRef.current?.currentTime ?? 0)}
                      >
                        Use time
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">Format: m:ss.s (e.g. 1:23.4) or plain seconds.</p>
                <Button type="button" onClick={addClip} disabled={rangeEnd <= rangeStart} className="w-full">
                  <Plus className="h-4 w-4" /> Add clip
                </Button>
              </div>
            ) : null}
          </SectionCard>
        )}

        {clips.length > 0 && (
          <SectionCard title={`3. Arrange (${clips.length} clip${clips.length > 1 ? 's' : ''})`}>
            <ol className="space-y-2">
              {clips.map((clip, i) => (
                <li key={i}>
                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">#{i + 1}</span>
                      <span className="text-muted-foreground">
                        {formatTime(clip.start)} → {formatTime(clip.end)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => moveClip(i, -1)}>
                        ↑
                      </Button>
                      <Button variant="ghost" size="sm" disabled={i === clips.length - 1} onClick={() => moveClip(i, 1)}>
                        ↓
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeClip(i)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {i < clips.length - 1 && (
                    <div className="ml-4 mt-2 flex items-center gap-2 border-l border-dashed border-border pl-4 text-xs text-muted-foreground">
                      transition
                      <Select value={transitions[i]} onValueChange={(v) => setTransition(i, v as TransitionType)}>
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cut">Cut</SelectItem>
                          <SelectItem value="fade">Fade</SelectItem>
                          <SelectItem value="slide">Slide</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <Button className="mt-4 w-full" onClick={handleExport} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Export'}
            </Button>
            {exportError && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{exportError}</AlertDescription>
              </Alert>
            )}
          </SectionCard>
        )}

        {job && (
          <SectionCard title="4. Export">
            <div className="flex items-center justify-between">
              <StatusPill status={job.status} progress={job.progress} />
              {job.status === 'done' && job.downloadUrl && (
                <a href={job.downloadUrl} download>
                  <Button size="sm">
                    <Download className="h-4 w-4" /> Download
                  </Button>
                </a>
              )}
            </div>
            {(job.status === 'queued' || job.status === 'processing') && (
              <div className="mt-3">
                <ProgressBar value={job.progress ?? 0} />
              </div>
            )}
            {job.status === 'error' && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{job.error}</AlertDescription>
              </Alert>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
