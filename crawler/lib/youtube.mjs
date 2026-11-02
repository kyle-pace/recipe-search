// Video sources through the official YouTube Data API only. The whole
// uploads list is re-read on every run, so removed or private videos drop
// out and stored data is never older than a week (the rule is 30 days).

const API = 'https://www.googleapis.com/youtube/v3';
const DESCRIPTION_CHARS = 280; // enough to search on, never a full recipe

export async function fetchChannelVideos(channelUrl, key, { fetchImpl = fetch } = {}) {
  const handle = channelUrl.match(/@([\w.-]+)/)?.[1];
  if (!handle) throw new Error(`no @handle in ${channelUrl}`);
  const ch = await getJson(fetchImpl, `${API}/channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}&key=${key}`);
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`channel @${handle} not found`);

  const videos = [];
  let pageToken = '';
  for (let page = 0; page < 100; page++) {
    const url = `${API}/playlistItems?part=snippet,status&maxResults=50&playlistId=${uploads}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const data = await getJson(fetchImpl, url);
    for (const item of data.items || []) {
      const v = toVideo(item);
      if (v) videos.push(v);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  videos.sort((a, b) => (a.p < b.p ? 1 : a.p > b.p ? -1 : 0));
  return videos;
}

export function toVideo(item) {
  const s = item.snippet || {};
  const status = item.status?.privacyStatus;
  const id = s.resourceId?.videoId;
  if (!id || (status && status !== 'public')) return null;
  if (/^(private|deleted) video$/i.test(s.title || '')) return null;
  const d = (s.description || '').replace(/\s+/g, ' ').trim();
  const out = {
    id,
    n: s.title,
    p: (s.publishedAt || '').slice(0, 10),
  };
  if (d) out.d = d.length > DESCRIPTION_CHARS ? d.slice(0, DESCRIPTION_CHARS).replace(/\s+\S*$/, '') + '…' : d;
  const th = s.thumbnails?.medium?.url || s.thumbnails?.default?.url;
  if (th) out.th = th;
  return out;
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const reason = body.match(/"reason":\s*"([^"]+)"/)?.[1] || '';
    throw new Error(`YouTube API HTTP ${res.status} ${reason}`.trim());
  }
  return res.json();
}
