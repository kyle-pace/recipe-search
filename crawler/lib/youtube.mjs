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
  // Mark Shorts (sh: 1), so the index can leave them out. YouTube keeps each channel's
  // Shorts in their own playlist, "UUSH" plus the channel id (the uploads list is "UU"
  // plus it). That list isn't documented, so if it can't be read, fall back to the
  // documented way: a video a minute or shorter counts as a Short.
  const shorts = await shortIds(fetchImpl, key, uploads, videos).catch(() => null) ?? (await shortByLength(fetchImpl, key, videos));
  for (const v of videos) if (shorts.has(v.id)) v.sh = 1;
  videos.sort((a, b) => (a.p < b.p ? 1 : a.p > b.p ? -1 : 0));
  return videos;
}

async function shortIds(fetchImpl, key, uploads) {
  const ids = new Set();
  let pageToken = '';
  for (let page = 0; page < 100; page++) {
    const url = `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=UUSH${uploads.slice(2)}&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    let data;
    try {
      data = await getJson(fetchImpl, url);
    } catch (err) {
      // A channel with no Shorts has no Shorts playlist: that's an empty list, not a failure.
      if (/HTTP 404/.test(err.message) && page === 0) return ids;
      throw err;
    }
    for (const item of data.items || []) if (item.contentDetails?.videoId) ids.add(item.contentDetails.videoId);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

async function shortByLength(fetchImpl, key, videos) {
  const ids = new Set();
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50).map((v) => v.id);
    const data = await getJson(fetchImpl, `${API}/videos?part=contentDetails&id=${batch.join(',')}&key=${key}`);
    for (const item of data.items || []) if (seconds(item.contentDetails?.duration) <= 60) ids.add(item.id);
  }
  return ids;
}

/** "PT1M5S" -> 65 */
export function seconds(iso = '') {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return Infinity;
  const [, d = 0, h = 0, mi = 0, s = 0] = m.map((x) => Number(x || 0));
  return ((d * 24 + h) * 60 + mi) * 60 + s;
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
