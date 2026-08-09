import { spawn } from 'child_process';

export interface RunOptions {
  /** Hard wall-clock limit. The child is SIGKILLed on timeout so a stuck
   * ffmpeg/yt-dlp process can never wedge the single-worker queue forever. */
  timeoutMs: number;
  onOutputLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}

/**
 * Runs a CLI tool via spawn (never a shell string) so user-controlled values
 * (URLs, timestamps) can never be interpreted as shell syntax. Streams
 * stdout/stderr as they arrive instead of buffering unboundedly, and returns
 * the full stdout once the process exits successfully.
 */
export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderrTail = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    const onChunk = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        stdout += text;
      } else {
        stderrTail = (stderrTail + text).slice(-4000);
      }
      if (opts.onOutputLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) opts.onOutputLine(line, stream);
        }
      }
    };
    child.stdout?.on('data', onChunk('stdout'));
    child.stderr?.on('data', onChunk('stderr'));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with code ${code}: ${stderrTail.trim().slice(-500)}`));
    });
  });
}
