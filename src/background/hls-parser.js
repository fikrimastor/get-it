function resolveUrl(uri, baseUrl) {
  return new URL(uri, baseUrl).toString();
}

function parseAttributeList(str) {
  const attrs = {};
  const regex = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

function parseMediaPlaylist(text, baseUrl) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const segmentUrls = [];
  let initUrl = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (attrs.URI) {
        initUrl = resolveUrl(attrs.URI, baseUrl);
      }
    } else if (!line.startsWith('#')) {
      segmentUrls.push(resolveUrl(line, baseUrl));
    }
  }

  return {
    container: initUrl ? 'fmp4' : 'ts',
    initUrl,
    segmentUrls,
  };
}

export async function parseM3U8(text, baseUrl, fetchFn = fetch) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF:'));

  if (!isMaster) {
    const playlist = parseMediaPlaylist(text, baseUrl);
    return [
      {
        id: 'default',
        label: 'Default quality',
        bandwidth: 0,
        width: 0,
        height: 0,
        container: playlist.container,
        videoInitUrl: playlist.initUrl,
        videoSegmentUrls: playlist.segmentUrls,
        audioInitUrl: null,
        audioSegmentUrls: [],
      },
    ];
  }

  const renditions = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
    const variantUri = lines[i + 1];
    if (!variantUri || variantUri.startsWith('#')) continue;

    const variantUrl = resolveUrl(variantUri, baseUrl);
    const bandwidth = Number(attrs.BANDWIDTH) || 0;
    let width = 0;
    let height = 0;
    if (attrs.RESOLUTION) {
      const [w, h] = attrs.RESOLUTION.split('x').map(Number);
      width = w || 0;
      height = h || 0;
    }

    const variantResponse = await fetchFn(variantUrl);
    const variantText = await variantResponse.text();
    const playlist = parseMediaPlaylist(variantText, variantUrl);

    renditions.push({
      id: `variant-${renditions.length}`,
      label: height ? `${height}p` : `${Math.round(bandwidth / 1000)}kbps`,
      bandwidth,
      width,
      height,
      container: playlist.container,
      videoInitUrl: playlist.initUrl,
      videoSegmentUrls: playlist.segmentUrls,
      audioInitUrl: null,
      audioSegmentUrls: [],
    });
  }

  renditions.sort((a, b) => b.bandwidth - a.bandwidth);
  return renditions;
}
