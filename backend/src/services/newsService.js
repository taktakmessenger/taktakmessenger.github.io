const NewsSource = require('../models/NewsSource');
const Video = require('../models/Video');
const { HttpError } = require('../utils/http');

// News verification.
//
// The badge answers one question: "is this really from the newsroom it says?"
// Two conditions must both hold, and neither is something the uploader can
// satisfy alone:
//
//   1. The source exists and is `verified` — a human vetted the organisation.
//   2. The submitted link actually points at that organisation's domain, so a
//      video cannot cite a real outlet while linking somewhere else.
//
// Only then may an administrator mark the video `newsVerified`. The check is
// re-run at that moment rather than trusted from upload time, because the
// source's status can be revoked in between.

// Compares hostnames, not raw strings: `https://www.bbc.com/x` and
// `bbc.com` are the same publisher, while `bbc.com.evil.test` is not.
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function domainMatches(source, url) {
  const host = hostnameOf(url);
  if (!host) return false;

  return (source.domains || []).some((domain) => {
    const clean = String(domain).toLowerCase().replace(/^www\./, '');
    // Exact match or a true subdomain. The leading dot is what stops
    // "evilbbc.com" from matching a source that owns "bbc.com".
    return host === clean || host.endsWith(`.${clean}`);
  });
}

/**
 * Validate a creator's news claim. Returns the source when the claim is
 * coherent, throws otherwise.
 *
 * Used at upload time to reject an incoherent claim early, and again before an
 * administrator grants the badge.
 */
async function validateClaim({ sourceId, sourceUrl }) {
  if (!sourceId) throw new HttpError(400, 'Falta la fuente de la noticia');

  const source = await NewsSource.findById(sourceId);
  if (!source) throw new HttpError(404, 'Fuente de noticia no encontrada');
  if (source.status !== 'verified') {
    throw new HttpError(400, 'Esa fuente no está verificada');
  }
  if (!sourceUrl) throw new HttpError(400, 'Falta el enlace a la noticia original');
  if (!domainMatches(source, sourceUrl)) {
    throw new HttpError(
      400,
      `El enlace no pertenece a un dominio de ${source.name}`
    );
  }

  return source;
}

/**
 * Administrator grants the badge to a video.
 *
 * Re-validates the claim from scratch: the source may have been revoked, or the
 * video edited, since upload. Granting on the strength of the earlier check
 * would let a video keep a badge it no longer deserves.
 */
async function grantBadge(videoId, adminId) {
  const video = await Video.findById(videoId);
  if (!video) throw new HttpError(404, 'Video no encontrado');

  await validateClaim({ sourceId: video.newsSource, sourceUrl: video.sourceUrl });

  video.newsVerified = true;
  video.newsVerifiedAt = new Date();
  video.newsVerifiedBy = adminId;
  await video.save();

  return video;
}

async function revokeBadge(videoId) {
  const video = await Video.findById(videoId);
  if (!video) throw new HttpError(404, 'Video no encontrado');

  video.newsVerified = false;
  video.newsVerifiedAt = null;
  video.newsVerifiedBy = null;
  await video.save();

  return video;
}

/**
 * Queue a new source for review. Anyone may propose one; only an administrator
 * may approve it, which is the whole point of the separation.
 */
async function proposeSource({ name, domains = [], evidenceUrl = null, submittedBy }) {
  const clean = String(name || '').trim();
  if (!clean) throw new HttpError(400, 'El nombre de la fuente es requerido');

  const existing = await NewsSource.findOne({ name: clean });
  if (existing) return existing;

  return NewsSource.create({
    name: clean,
    domains: domains.map((d) => String(d).trim().toLowerCase()).filter(Boolean),
    evidenceUrl,
    status: 'pending',
    notes: submittedBy ? `Propuesta por ${submittedBy}` : null,
  });
}

async function setSourceStatus(sourceId, status, adminId) {
  if (!['verified', 'revoked', 'pending'].includes(status)) {
    throw new HttpError(400, 'Estado de fuente inválido');
  }

  const source = await NewsSource.findById(sourceId);
  if (!source) throw new HttpError(404, 'Fuente no encontrada');

  source.status = status;
  source.verifiedAt = status === 'verified' ? new Date() : null;
  source.verifiedBy = status === 'verified' ? adminId : null;
  await source.save();

  // Revoking a source must also strip the badge from everything already
  // published under it, otherwise a revoked outlet keeps its credibility on
  // content that is already live.
  if (status !== 'verified') {
    await Video.updateMany(
      { newsSource: source._id, newsVerified: true },
      { $set: { newsVerified: false, newsVerifiedAt: null, newsVerifiedBy: null } }
    );
  }

  return source;
}

module.exports = {
  validateClaim,
  grantBadge,
  revokeBadge,
  proposeSource,
  setSourceStatus,
  domainMatches,
  hostnameOf,
};
