// Whitelist of YouTube hosts. Rejecting anything else up front means we
// never hand an arbitrary user-supplied URL/protocol to yt-dlp's extractor.
const YOUTUBE_HOST_RE = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i;

export function isValidYoutubeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (!YOUTUBE_HOST_RE.test(url.hostname)) return false;
  if (url.hostname.includes('youtu.be')) return url.pathname.length > 1;
  if (url.pathname === '/watch') return url.searchParams.has('v');
  if (url.pathname.startsWith('/shorts/')) return true;
  return false;
}
