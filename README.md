# ClipForge

Paste a YouTube URL, pick one or more time ranges, choose a transition between
each pair, export a single merged MP4, download it.

Built for a fixed target: **one AWS ECS Fargate task at 0.5 vCPU / 1GB RAM.**
That constraint drove almost every decision below more than any specific
feature did.

## Quick start

```bash
docker build -t clipforge .
docker run --rm -p 3000:3000 --memory=1g --cpus=0.5 clipforge
```

Open http://localhost:3000. The `--memory=1g --cpus=0.5` flags simulate the
target Fargate task shape locally, per the brief.

Dev mode (hot reload, no Docker):

```bash
# terminal 1
cd backend && npm install && npm run start:dev   # :3000

# terminal 2
cd frontend && npm install && npm run dev        # :5173, proxies /api -> :3000
```

`ffmpeg`, `ffprobe`, and `yt-dlp` must be on `PATH` for dev mode (they're
installed automatically inside the Docker image).

## Architecture

```
Browser
  |  HTTP (JSON API + Range-enabled video streaming)
  v
+-----------------------------------------------+
|  Single NestJS process (one container)         |
|  - serves the built React app as static        |
|    files                                        |
|  - REST API: /api/videos, /api/jobs             |
|  - ONE shared in-memory FIFO queue              |
|      - download task (yt-dlp)                   |
|      - export task (ffmpeg)                     |
|    -> at most one CPU-heavy child process        |
|       running at a time, ever                    |
|  - in-memory Maps for video/job state            |
|  - local disk under DATA_DIR for files           |
+-----------------------------------------------+
```

One container, one process, one queue. That's not "the simple version of a
bigger design" - it's the design that actually fits a 0.5 vCPU task. A second
concurrent ffmpeg process doesn't run twice as slow on half a core, it
contends for the same half core and both get slower, and a second concurrent
yt-dlp download competes with it for the same limited RAM. Serializing
everything through one queue is what keeps the container predictable instead
of occasionally OOM-killed.

## The core design decision: how merging/transitions actually run

This is the one place CPU usage is a real design problem, so it got the most
thought (and the most back-and-forth - see the process note at the bottom).

**Two export paths, chosen per job:**

- **Every junction is `cut`** -> stream-copy trim (`ffmpeg -c copy`) each
  clip, then stitch with the concat demuxer. No re-encoding at all. This is
  near-instant regardless of clip length, because it's just repackaging
  existing encoded bytes.
- **Any junction is `fade`/`slide`** -> one ffmpeg process, one
  `filter_complex` graph: trim each clip, normalize to a common
  854x480/yuv420p/30fps canvas (transitions require matching dimensions
  across inputs), chain `xfade`/`acrossfade` between them, encode **once**
  for the final output only.

**What I deliberately did not build:** re-encoding only the ~1s window
around each transition, stream-copying the untouched middle of every clip,
and stitching everything back together with the concat demuxer. That's the
theoretically optimal approach - CPU cost scales with number of transitions,
not total output length - and I seriously considered it (an independent pass
at this same problem from another AI proposed exactly that). I cut it for
one concrete reason: the concat demuxer requires byte-exact matching stream
parameters (codec, profile, pix_fmt, timebase, sample rate) between the
freshly re-encoded transition chunks and the copied chunks, or it fails or
produces corrupt output. That's a well-known ffmpeg debugging trap, and for
a ~2 hour build the downside risk (burning the time budget on ffmpeg
plumbing instead of a working product) outweighed the upside (faster
exports that contain a fade). The single-`filter_complex` path never hits
that failure mode at all, because there's no concat demuxer step in it -
only a normal encode. It's a documented, deliberate trade, not an oversight.

The practical effect: a plain cuts-only export (arguably the most common
case) is nearly free on the CPU budget; only exports that actually use a
fade/slide pay for a real encode, and even then it's exactly one encode of
the final duration - never a multiple of it.

## Concrete resource-tuning choices

- **Download caps**: <=480p, <=15 min, <=200MB, enforced via `yt-dlp` flags
  *before* a full download happens. Bounds worst-case disk/memory/time
  before we've even seen the video.
- **`ffmpeg -preset veryfast -crf 23`**: trades a bit of encode efficiency
  for speed - the right trade when CPU, not bitrate, is the scarce resource.
- **`NODE_OPTIONS=--max-old-space-size=256`**: caps Node's V8 heap inside
  the 1GB container so a memory-hungry ffmpeg child process (which manages
  its own memory outside the V8 heap, but shares the same cgroup limit)
  can't be starved or OOM-killed by Node holding too much of the budget.
- **Every spawned process has a hard timeout + `SIGKILL`** (`process.util.ts`).
  Since the queue runs one task at a time, a single stuck ffmpeg/yt-dlp
  process would otherwise wedge the entire pipeline forever with no other
  worker to pick up the next job.
- **Nothing buffers a full video in memory.** Downloads stream to disk;
  exports/source video are served via `fs.createReadStream` (with HTTP
  Range support for the preview player, so scrubbing doesn't require
  downloading the whole file first); ffmpeg output goes straight to disk.
- **`child_process.spawn` with an argv array, never a shell string.** URLs
  and timestamps are user input; spawning without a shell means they can
  never be interpreted as shell syntax, regardless of content.

## What I chose not to build, and why

- **No database.** In-memory `Map`s for video/job state. State is lost on
  restart - acceptable for a prototype, called out explicitly rather than
  hidden. A real deployment swaps this for Postgres/DynamoDB without
  touching the queue or ffmpeg logic, since both stores already sit behind
  a narrow interface (`VideoStoreService`/`JobStoreService`).
- **No auth / multi-tenancy.** Out of scope for a single-user prototype.
- **No waveform/thumbnail scrubber for range selection.** A plain HTML5
  `<video>` player plus numeric start/end fields (with a "use current time"
  button tied to the player's playhead) covers the same job for near-zero
  backend cost - no per-timestamp ffmpeg thumbnail generation competing for
  the same CPU budget the encoder needs.
- **The boundary-only re-encode optimization** described above.
- **No horizontal scaling / SQS / S3 wiring in the code.** The brief asks
  for a design that targets a single 0.5vCPU/1GB task; the scaling path is
  answered below rather than built, since building it would mean guessing
  at infrastructure the brief didn't ask this prototype to stand up.
- **Only three transitions** (cut / fade / slide-left) - covers the brief's
  examples without turning transition-authoring into its own feature.

## Product sense

The brief's bar is "paste a link, select clips, export, download" feeling
complete, not just possible. Concretely:

- **Live progress, not a spinner.** Both download and export status poll
  every 1.2s and show a real percentage - parsed from yt-dlp's `[download]`
  lines and ffmpeg's `time=` output, not a fake progress bar.
- **Scrubbing works.** The source video is served with HTTP Range support,
  so the preview player seeks instantly instead of buffering the whole file.
- **Picking a range doesn't require typing timestamps.** A "use current
  time" button next to each start/end field grabs the player's current
  playhead position.
- **Errors are specific, not generic.** Validation failures (bad URL, clip
  past the video's duration, too many clips) surface the actual reason
  inline, via the same `{success:false, message}` envelope the whole API
  uses - not a silent failure or a raw stack trace.
- **The queue is honest about itself.** `queuePosition` is returned on
  submission so a second job knows it's waiting, not stuck.

## Code layout

- `backend/src/jobs/export.service.ts` - the core logic worth reading first:
  the two export strategies described above.
- `backend/src/common/task-queue.service.ts` - the concurrency control that
  makes the resource story true (one job at a time, always).
- `backend/src/common/process.util.ts` - the spawn/timeout/kill wrapper
  every ffmpeg/yt-dlp call goes through.
- `backend/src/videos/`, `backend/src/jobs/` - one NestJS module per
  feature (download+source-streaming, export+download) rather than a
  layered architecture - see the process note at the bottom for why.
- `frontend/src/App.tsx` - the whole UI; small enough that splitting it
  into more files would've cost more to navigate than it saved.

## What breaks first under the resource constraint (and at 1,000 concurrent submissions)

**CPU on the single worker, immediately**, followed closely by **local
disk**. The whole design puts exactly one yt-dlp/ffmpeg process in flight at
a time on a 0.5 vCPU container - correct for one task, but it means 1,000
simultaneous submissions form a queue thousands of jobs long behind a worker
that finishes roughly one job every 30-90 seconds. Users would wait hours,
and every download/export lands on that same container's ephemeral disk,
which fills up long before the CPU queue drains.

Fix, roughly in the order I'd actually do it:

1. **Split the API and the worker into separate ECS services.** They're one
   process by design here (see Architecture) - that's precisely the thing
   to undo first, so the API stays responsive to accept and report on jobs
   even while every worker is fully saturated.
2. **Move the in-memory queue to SQS.** Durable across restarts, and it's
   the natural signal for ECS Service Auto Scaling (scale worker task count
   on `ApproximateNumberOfMessagesVisible`). Horizontal fan-out of many
   small 0.5vCPU workers fits this workload better than giving one task
   more CPU - a single short export doesn't parallelize well internally,
   but independent jobs parallelize perfectly across tasks.
3. **Move storage to S3** for both source downloads and exports. Removes
   the disk ceiling, makes the API tier stateless (so it scales
   horizontally too), and lets downloads/uploads go through pre-signed URLs
   instead of proxying bytes through Node.
4. **Surface queue position / ETA in the UI** instead of a silent wait - the
   job store already tracks queue depth (`TaskQueueService.pendingCount`),
   it just needs exposing. Keeps the product feeling "complete" under load
   instead of just slow.
5. **Dedupe by source URL.** At 1,000 submissions, many will likely be the
   same trending video - download once, reuse the source file for every job
   referencing it. Cuts download bandwidth and disk usage at the same time.

Deliberately **not** the first fix: giving the single task more vCPU/RAM.
ffmpeg's encode speed for one short job improves sub-linearly with more
cores, while horizontal scaling of many small workers scales close to
linearly with total job throughput - a better fit for both this workload and
this budget.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/videos` | `{ url }` -> queues a download, returns `{ id }` |
| `GET` | `/api/videos/:id` | Poll status/metadata |
| `GET` | `/api/videos/:id/source` | Stream the source (Range-enabled, for the preview player) |
| `POST` | `/api/videos/:id/export` | `{ clips: [{start,end}], transitions: ['cut'\|'fade'\|'slide'] }` -> queues an export, returns `{ jobId }` |
| `GET` | `/api/jobs/:id` | Poll status/progress; includes `downloadUrl` once done |
| `GET` | `/api/jobs/:id/download` | Streams the finished MP4 |

All JSON responses use a `{ success, data }` / `{ success: false, message,
code }` envelope (`common/api-response.ts` + a global `ApiExceptionFilter`),
ported and trimmed from an internal boilerplate kit - the full version
supported pagination and auth-error shapes this app has no use for.

## Known limitations

- Stream-copy trims (pure-cut exports) snap to the nearest keyframe, so an
  exact cut point can land up to ~1-2s off the exact selection. The
  fade/slide path always re-encodes and doesn't have this issue.
- Assumes the source has both a video and an audio stream.
- In-memory state means a container restart loses all in-flight video/job
  records - by design, see above.

## What I'd reuse vs. build fresh (process note)

The backend intentionally does **not** reuse an internal NestJS
CRUD/clean-architecture template (TypeORM + Postgres + 4-layer
api/application/domain/infrastructure + CQRS) that was prepped ahead of time
for this kind of exercise: this app has no persistent entities and no
cross-module write complexity for that structure to manage, so applying it
would have meant building unused layers to stay "consistent" rather than to
solve anything. The frontend **does** reuse actual UI primitives (Button,
Input, Select, Alert, Skeleton, the theme tokens) ported from that same prep
kit's component library, since those are plain framework-agnostic React +
Tailwind + Radix components with no such mismatch - only the page-level
scaffolding patterns that assumed a paginated CRUD table were left out,
because this UI has no table to paginate.
