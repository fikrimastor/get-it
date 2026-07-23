// Deliberately scoped DASH MPD parser (no XML-parsing dependency — see
// Global Constraints for why). Handles the common case: a single Period,
// SegmentTemplate with $Number$ substitution, static (non-live) manifests.

function getAttr(tagText, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : null;
}

function findTags(xml, tagName) {
  const results = [];
  const re = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push({ attrsText: m[1], innerText: m[2] || '' });
  }
  return results;
}

// SegmentTemplate declared directly under AdaptationSet always appears
// before the first Representation child in real-world manifests. Slicing
// to that point avoids accidentally matching a Representation's own
// (differently-scoped) SegmentTemplate override.
function extractDirectSegmentTemplate(xml) {
  const repIndex = xml.indexOf('<Representation');
  const scope = repIndex === -1 ? xml : xml.slice(0, repIndex);
  return findTags(scope, 'SegmentTemplate')[0] || null;
}

function parseISO8601Duration(str) {
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(str || '');
  if (!match) return 0;
  const hours = parseFloat(match[1] || '0');
  const minutes = parseFloat(match[2] || '0');
  const seconds = parseFloat(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

function resolveUrl(uri, baseUrl) {
  return new URL(uri, baseUrl).toString();
}

function parseSegmentTemplate(tagText) {
  return {
    media: getAttr(tagText, 'media'),
    initialization: getAttr(tagText, 'initialization'),
    timescale: Number(getAttr(tagText, 'timescale')) || 1,
    duration: Number(getAttr(tagText, 'duration')) || 0,
    startNumber: Number(getAttr(tagText, 'startNumber')) || 1,
  };
}

function buildSegmentUrls(template, representationId, baseUrl, totalDurationSeconds) {
  if (!template || !template.media) {
    return { initUrl: null, segmentUrls: [] };
  }
  const initUrl = template.initialization
    ? resolveUrl(template.initialization.replace(/\$RepresentationID\$/g, representationId), baseUrl)
    : null;

  const totalSegments = template.duration > 0
    ? Math.ceil((totalDurationSeconds * template.timescale) / template.duration)
    : 0;

  const segmentUrls = [];
  for (let n = template.startNumber; n < template.startNumber + totalSegments; n++) {
    const media = template.media
      .replace(/\$RepresentationID\$/g, representationId)
      .replace(/\$Number\$/g, String(n));
    segmentUrls.push(resolveUrl(media, baseUrl));
  }
  return { initUrl, segmentUrls };
}

function representationsOf(adaptationSetInnerXml) {
  const setLevelTemplateTag = extractDirectSegmentTemplate(adaptationSetInnerXml);
  const reps = findTags(adaptationSetInnerXml, 'Representation');
  return reps.map((rep) => {
    const repTemplateTag = findTags(rep.innerText, 'SegmentTemplate')[0];
    const templateTag = repTemplateTag || setLevelTemplateTag;
    return {
      id: getAttr(rep.attrsText, 'id') || 'default',
      bandwidth: Number(getAttr(rep.attrsText, 'bandwidth')) || 0,
      width: Number(getAttr(rep.attrsText, 'width')) || 0,
      height: Number(getAttr(rep.attrsText, 'height')) || 0,
      template: templateTag ? parseSegmentTemplate(templateTag.attrsText) : null,
    };
  });
}

export function parseMPD(xmlText, baseUrl) {
  const mpdTag = findTags(xmlText, 'MPD')[0];
  const totalDuration = parseISO8601Duration(mpdTag ? getAttr(mpdTag.attrsText, 'mediaPresentationDuration') : null);

  const periods = findTags(xmlText, 'Period');
  if (periods.length === 0) return [];
  const period = periods[0];

  const adaptationSets = findTags(period.innerText, 'AdaptationSet');

  let videoReps = [];
  let audioReps = [];
  for (const set of adaptationSets) {
    const mimeType = getAttr(set.attrsText, 'mimeType') || getAttr(set.attrsText, 'contentType') || '';
    const reps = representationsOf(set.innerText);
    if (mimeType.startsWith('video')) {
      videoReps = videoReps.concat(reps);
    } else if (mimeType.startsWith('audio')) {
      audioReps = audioReps.concat(reps);
    }
  }

  const chosenAudio = audioReps[0] || null;
  const audioBuilt = chosenAudio
    ? buildSegmentUrls(chosenAudio.template, chosenAudio.id, baseUrl, totalDuration)
    : { initUrl: null, segmentUrls: [] };

  const renditions = videoReps.map((rep, index) => {
    const video = buildSegmentUrls(rep.template, rep.id, baseUrl, totalDuration);
    return {
      id: `dash-${index}`,
      label: rep.height ? `${rep.height}p` : (rep.bandwidth ? `${Math.round(rep.bandwidth / 1000)}kbps` : `rendition ${index + 1}`),
      bandwidth: rep.bandwidth,
      width: rep.width,
      height: rep.height,
      container: 'fmp4',
      videoInitUrl: video.initUrl,
      videoSegmentUrls: video.segmentUrls,
      audioInitUrl: chosenAudio ? audioBuilt.initUrl : null,
      audioSegmentUrls: chosenAudio ? audioBuilt.segmentUrls : [],
    };
  });

  renditions.sort((a, b) => b.bandwidth - a.bandwidth);
  return renditions;
}
