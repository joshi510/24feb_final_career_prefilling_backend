/**
 * Resolves #1 globally ranked career title using the same engine as the student report (frontend careerEngine).
 * Uses dynamic import of frontend ESM from Node (frontend/package.json has "type": "module").
 *
 * Fallbacks: normalized dimensions from AI variants, RIASEC scores object, first careerPathways role,
 * then career_direction text — so counsellor list is rarely blank when a report exists.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const RIASEC_LETTERS = ['R', 'I', 'A', 'S', 'E', 'C'];
const RIASEC_SET = new Set(RIASEC_LETTERS);

/** Map common AI / label variants to Holland letter */
const NAME_PREFIX_TO_CODE = [
  ['realistic', 'R'],
  ['investigative', 'I'],
  ['artistic', 'A'],
  ['social', 'S'],
  ['enterprising', 'E'],
  ['conventional', 'C']
];

let engineModulePromise = null;

function getCareerEngineModule() {
  if (!engineModulePromise) {
    const enginePath = path.join(__dirname, '../../frontend/src/utils/careerEngine.js');
    engineModulePromise = import(pathToFileURL(enginePath).href);
  }
  return engineModulePromise;
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeRiasecCode(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const one = s.charAt(0).toUpperCase();
  if (s.length === 1 && RIASEC_SET.has(one)) return one;
  const lower = s.toLowerCase();
  for (const [prefix, code] of NAME_PREFIX_TO_CODE) {
    if (lower.startsWith(prefix)) return code;
  }
  return null;
}

/**
 * @param {object} scores
 * @param {string} letter - R, I, ...
 */
function readScoreKey(scores, letter) {
  if (!scores || typeof scores !== 'object') return 0;
  const u = letter.toUpperCase();
  const l = letter.toLowerCase();
  const v = scores[u] ?? scores[l];
  return Number(v) || 0;
}

/**
 * @param {object|string|null} riasecReportColumn
 * @returns {object|null}
 */
function parseRiasecReportObject(riasecReportColumn) {
  let data = riasecReportColumn;
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === 'object' && data !== null ? data : null;
}

/**
 * Unwrap DB shapes: { scores, report }, { cacheKey, report }, or double-nested report.
 * @param {object} data
 * @returns {{ innerReport: object, scoresRoot: object|null }}
 */
function unwrapReportPayload(data) {
  let inner = data.report && typeof data.report === 'object' ? data.report : data;
  // Double nest: { report: { report: { dimensions } } }
  if (
    inner &&
    !Array.isArray(inner.dimensions) &&
    inner.report &&
    typeof inner.report === 'object' &&
    Array.isArray(inner.report.dimensions)
  ) {
    inner = inner.report;
  }
  const scoresRoot =
    data.scores && typeof data.scores === 'object'
      ? data.scores
      : inner.scores && typeof inner.scores === 'object'
        ? inner.scores
        : null;
  return { innerReport: inner && typeof inner === 'object' ? inner : data, scoresRoot };
}

/**
 * First pathway role from Gemini/deterministic report (good UX when engine import fails).
 * @param {object} data - parsed riasec_report root
 * @returns {string|null}
 */
function extractFallbackCareerTitleFromRiasecReport(data) {
  if (!data || typeof data !== 'object') return null;
  const { innerReport } = unwrapReportPayload(data);
  const pathways = innerReport.careerPathways;
  if (!Array.isArray(pathways) || pathways.length === 0) return null;
  const first = pathways[0];
  if (!first || typeof first !== 'object') return null;
  const role = first.careerRole || first.role || first.title || first.name;
  const s = role != null ? String(role).trim() : '';
  return s || null;
}

/**
 * @param {Array<{ code: string, score?: number }>|null|undefined} dimensions
 * @returns {Promise<string|null>}
 */
async function getTopRankedCareerTitle(dimensions) {
  try {
    if (!dimensions || !Array.isArray(dimensions) || dimensions.length === 0) {
      return null;
    }
    const { getFieldRecommendations, isValidDimensionsInput } = await getCareerEngineModule();
    if (!isValidDimensionsInput(dimensions)) {
      return null;
    }
    const rec = getFieldRecommendations(dimensions);
    if (!rec?.valid || !rec.rankedCareersGlobal?.length) {
      return null;
    }
    const title = rec.rankedCareersGlobal[0]?.title;
    return title && String(title).trim() ? String(title).trim() : null;
  } catch (err) {
    console.warn('[topCareerFromEngine] Could not rank careers:', err.message);
    return null;
  }
}

/**
 * @param {object|string|null} riasecReportColumn - interpreted_results.riasec_report JSON
 * @returns {Array<{ code: string, score: number }>|null}
 */
function extractDimensionsFromRiasecReport(riasecReportColumn) {
  const data = parseRiasecReportObject(riasecReportColumn);
  if (!data) return null;

  const { innerReport, scoresRoot } = unwrapReportPayload(data);

  const dims = innerReport?.dimensions;
  if (Array.isArray(dims) && dims.length > 0) {
    const out = [];
    for (const d of dims) {
      if (!d || typeof d !== 'object') continue;
      const code = normalizeRiasecCode(d.code);
      if (!code) continue;
      out.push({ code, score: Number(d.score) || 0 });
    }
    if (out.length) {
      return out;
    }
  }

  // riasecProfile.topTraits often has valid letter codes + scores
  const topTraits = innerReport?.riasecProfile?.topTraits;
  if (Array.isArray(topTraits) && topTraits.length > 0) {
    const out = [];
    for (const t of topTraits) {
      if (!t || typeof t !== 'object') continue;
      const code = normalizeRiasecCode(t.code);
      if (!code) continue;
      out.push({ code, score: Number(t.score) || 0 });
    }
    if (out.length) return out;
  }

  // Cached shape: { scores: { R, I, A, S, E, C }, report: {...} }
  const scores = scoresRoot || data.scores;
  if (scores && typeof scores === 'object') {
    const fromScores = RIASEC_LETTERS.map((c) => ({
      code: c,
      score: readScoreKey(scores, c)
    }));
    if (fromScores.some((d) => d.score > 0)) {
      return fromScores;
    }
  }

  return null;
}

/**
 * @param {string|null|undefined} careerDirection
 * @returns {string|null}
 */
function trimCareerDirection(careerDirection) {
  if (careerDirection == null) return null;
  const cd = String(careerDirection).trim();
  if (!cd) return null;
  return cd.length > 160 ? `${cd.slice(0, 157)}...` : cd;
}

/**
 * Single entry for counsellor student row: engine title → pathway role → career_direction.
 * @param {object|string|null} riasecReportColumn
 * @param {string|null|undefined} careerDirection
 * @returns {Promise<string|null>}
 */
async function resolveTopCareerMatchForList(riasecReportColumn, careerDirection) {
  const dims = extractDimensionsFromRiasecReport(riasecReportColumn);
  let title = await getTopRankedCareerTitle(dims);
  if (title) return title;

  const parsed = parseRiasecReportObject(riasecReportColumn);
  if (parsed) {
    title = extractFallbackCareerTitleFromRiasecReport(parsed);
    if (title) return title;
  }

  return trimCareerDirection(careerDirection);
}

module.exports = {
  getTopRankedCareerTitle,
  extractDimensionsFromRiasecReport,
  extractFallbackCareerTitleFromRiasecReport,
  resolveTopCareerMatchForList
};
