export const MERGE_STRATEGY = Object.freeze({
  DIRECT: 'direct',
  CONCAT_FMP4: 'concat-fmp4',
  REMUX_TS: 'remux-ts',
  SPLIT_TRACKS: 'split-tracks',
});

export function classifyMerge(rendition) {
  if (!rendition) return MERGE_STRATEGY.DIRECT;
  if (rendition.audioSegmentUrls && rendition.audioSegmentUrls.length > 0) {
    return MERGE_STRATEGY.SPLIT_TRACKS;
  }
  if (rendition.container === 'ts') {
    return MERGE_STRATEGY.REMUX_TS;
  }
  return MERGE_STRATEGY.CONCAT_FMP4;
}

export async function fetchSegments(urls, fetchFn = fetch) {
  const buffers = [];
  for (const url of urls) {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Segment fetch failed (${response.status}): ${url}`);
    }
    buffers.push(await response.arrayBuffer());
  }
  return buffers;
}

export async function mergeConcatFmp4(rendition, fetchFn = fetch) {
  const parts = [];
  if (rendition.videoInitUrl) {
    const [initBuffer] = await fetchSegments([rendition.videoInitUrl], fetchFn);
    parts.push(initBuffer);
  }
  const segmentBuffers = await fetchSegments(rendition.videoSegmentUrls, fetchFn);
  parts.push(...segmentBuffers);
  return new Blob(parts, { type: 'video/mp4' });
}

export function mergeTsWithTransmuxer(segmentBuffers, muxjsInstance) {
  return new Promise((resolve, reject) => {
    if (segmentBuffers.length === 0) {
      reject(new Error('No TS segments to merge'));
      return;
    }
    const transmuxer = new muxjsInstance.mp4.Transmuxer();
    let initSegment = null;
    const dataChunks = [];

    transmuxer.on('data', (segment) => {
      if (!initSegment && segment.initSegment) {
        initSegment = segment.initSegment;
      }
      dataChunks.push(segment.data);
    });
    transmuxer.on('done', () => {
      const parts = initSegment ? [initSegment, ...dataChunks] : dataChunks;
      if (parts.length === 0) {
        reject(new Error('Transmuxer produced no output'));
        return;
      }
      resolve(new Blob(parts, { type: 'video/mp4' }));
    });
    transmuxer.on('error', (err) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    try {
      for (const buffer of segmentBuffers) {
        transmuxer.push(new Uint8Array(buffer));
      }
      transmuxer.flush();
    } catch (err) {
      reject(err);
    }
  });
}

export async function mergeRemuxTs(rendition, fetchFn, muxjsInstance) {
  const segmentBuffers = await fetchSegments(rendition.videoSegmentUrls, fetchFn);
  return mergeTsWithTransmuxer(segmentBuffers, muxjsInstance);
}

export async function mergeSplitTracks(rendition, fetchFn = fetch) {
  const videoBlob = await mergeConcatFmp4(rendition, fetchFn);

  const audioParts = [];
  if (rendition.audioInitUrl) {
    const [initBuffer] = await fetchSegments([rendition.audioInitUrl], fetchFn);
    audioParts.push(initBuffer);
  }
  const audioSegmentBuffers = await fetchSegments(rendition.audioSegmentUrls, fetchFn);
  audioParts.push(...audioSegmentBuffers);

  return { videoBlob, audioBlob: new Blob(audioParts, { type: 'audio/mp4' }) };
}
