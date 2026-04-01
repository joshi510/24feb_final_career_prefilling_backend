const { InterpretedResult } = require('../models');

/**
 * Generate a cache key based on input parameters
 * Rounds scores to reduce cache key variations while maintaining accuracy
 */
function generateCacheKey(type, params) {
  if (type === 'riasec') {
    // Round RIASEC scores to nearest 5% to reduce cache variations
    const roundedR = Math.round((params.R || 0) / 5) * 5;
    const roundedI = Math.round((params.I || 0) / 5) * 5;
    const roundedA = Math.round((params.A || 0) / 5) * 5;
    const roundedS = Math.round((params.S || 0) / 5) * 5;
    const roundedE = Math.round((params.E || 0) / 5) * 5;
    const roundedC = Math.round((params.C || 0) / 5) * 5;
    
    // Sort to get top 3 for consistent key
    const scores = [
      { code: 'R', score: roundedR },
      { code: 'I', score: roundedI },
      { code: 'A', score: roundedA },
      { code: 'S', score: roundedS },
      { code: 'E', score: roundedE },
      { code: 'C', score: roundedC }
    ].sort((a, b) => b.score - a.score);
    
    const top3 = scores.slice(0, 3).map(s => s.code).join('-');
    return `riasec_${top3}_${roundedR}_${roundedI}_${roundedA}_${roundedS}_${roundedE}_${roundedC}`;
  }
  
  if (type === 'interpretation') {
    // Round percentage to nearest 5%
    const roundedPercentage = Math.round((params.percentage || 0) / 5) * 5;
    const roundedTotal = Math.round((params.total_questions || 0) / 10) * 10;
    const roundedCorrect = Math.round((params.correct_answers || 0) / 10) * 10;
    const readinessBand = params.readiness_status || 'Medium';
    
    // Create category hash
    let categoryHash = '';
    if (params.category_scores) {
      const sortedCategories = Object.entries(params.category_scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat, score]) => `${cat}:${Math.round(score / 5) * 5}`)
        .join('|');
      categoryHash = sortedCategories;
    }
    
    return `interpretation_${roundedPercentage}_${roundedTotal}_${roundedCorrect}_${readinessBand}_${categoryHash}`;
  }
  
  return null;
}

/**
 * Get cached response from database using optimized PostgreSQL JSON queries
 */
async function getCachedResponse(cacheKey, cacheType) {
  try {
    const { sequelize } = require('../database');
    const { Op } = require('sequelize');
    
    // For RIASEC reports, use PostgreSQL JSON query for fast lookup
    if (cacheType === 'riasec') {
      // Use raw SQL for efficient JSON field querying
      const [results] = await sequelize.query(`
        SELECT riasec_report, created_at
        FROM interpreted_results
        WHERE riasec_report IS NOT NULL
          AND riasec_report->>'cacheKey' = :cacheKey
          AND (riasec_report->>'cached_at')::timestamp > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT 1
      `, {
        replacements: { cacheKey },
        type: sequelize.QueryTypes.SELECT
      });
      
      if (results && results.riasec_report) {
        const report = typeof results.riasec_report === 'string' 
          ? JSON.parse(results.riasec_report) 
          : results.riasec_report;
        
        if (report.cacheKey === cacheKey && report.report) {
          console.log(`✅ Cache HIT for RIASEC: ${cacheKey.substring(0, 50)}...`);
          return report.report;
        }
      }
      
      console.log(`❌ Cache MISS for RIASEC: ${cacheKey.substring(0, 50)}...`);
    }
    
    // For interpretations, use direct cache key lookup
    if (cacheType === 'interpretation') {
      // Use raw SQL for efficient cache key lookup
      const [results] = await sequelize.query(`
        SELECT interpretation_text, strengths, areas_for_improvement, 
               risk_level, readiness_status, roadmap, cached_at
        FROM interpreted_results
        WHERE interpretation_cache_key = :cacheKey
          AND cached_at > NOW() - INTERVAL '30 days'
        ORDER BY cached_at DESC
        LIMIT 1
      `, {
        replacements: { cacheKey },
        type: sequelize.QueryTypes.SELECT
      });
      
      if (results) {
        try {
          const interpretation = {
            summary: results.interpretation_text || '',
            strengths: results.strengths ? (typeof results.strengths === 'string' ? JSON.parse(results.strengths) : results.strengths) : [],
            weaknesses: results.areas_for_improvement ? (typeof results.areas_for_improvement === 'string' ? JSON.parse(results.areas_for_improvement) : results.areas_for_improvement) : [],
            career_clusters: [],
            risk_level: results.risk_level || 'MEDIUM',
            readiness_status: results.readiness_status || 'PARTIALLY READY',
            action_plan: results.roadmap ? (typeof results.roadmap === 'string' ? JSON.parse(results.roadmap) : results.roadmap) : []
          };
          
          console.log(`✅ Cache HIT for Interpretation: ${cacheKey.substring(0, 50)}...`);
          return { interpretation };
        } catch (parseError) {
          console.warn('⚠️ Error parsing cached interpretation:', parseError.message);
        }
      }
      
      console.log(`❌ Cache MISS for Interpretation: ${cacheKey.substring(0, 50)}...`);
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error getting cached response:', error.message);
    // Don't fail the request if cache lookup fails
    return null;
  }
}

/**
 * Store response in cache
 */
async function storeCachedResponse(cacheKey, cacheType, response, testAttemptId = null) {
  try {
    if (cacheType === 'riasec') {
      // Store in InterpretedResult.riasec_report with cache key
      if (testAttemptId) {
        const [interpretedResult, created] = await InterpretedResult.findOrCreate({
          where: { test_attempt_id: testAttemptId },
          defaults: {
            test_attempt_id: testAttemptId,
            riasec_report: {
              cacheKey: cacheKey,
              report: response,
              cached_at: new Date().toISOString()
            },
            interpretation_text: 'Cached RIASEC report'
          }
        });
        
        if (!created) {
          await interpretedResult.update({
            riasec_report: {
              cacheKey: cacheKey,
              report: response,
              cached_at: new Date().toISOString()
            }
          });
        }
        
        console.log(`💾 Cached RIASEC response for attempt ${testAttemptId}: ${cacheKey.substring(0, 50)}...`);
      } else {
        // If no testAttemptId, find or create a record to store the cache
        // This allows cache to be shared across different test attempts
        const existing = await InterpretedResult.findOne({
          where: {
            riasec_report: {
              [require('sequelize').Op.ne]: null
            }
          },
          order: [['created_at', 'DESC']]
        });
        
        if (existing) {
          // Update existing record's cache
          const currentReport = existing.riasec_report || {};
          await existing.update({
            riasec_report: {
              ...currentReport,
              cacheKey: cacheKey,
              report: response,
              cached_at: new Date().toISOString()
            }
          });
          console.log(`💾 Cached RIASEC response (shared): ${cacheKey.substring(0, 50)}...`);
        }
      }
    }
    
    // For interpretations, store the cache key in InterpretedResult
    if (cacheType === 'interpretation') {
      // The cache key should be stored when the interpretation is saved
      // This is handled in geminiInterpreter.js when it saves to InterpretedResult
      // We just log it here for tracking
      console.log(`💾 Interpretation cache key generated: ${cacheKey.substring(0, 50)}...`);
      console.log(`💡 Note: Cache key should be stored in InterpretedResult.interpretation_cache_key when saving`);
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error storing cached response:', error.message);
    // Don't fail the request if caching fails
    return false;
  }
}

/**
 * Check if cache exists and is valid (not older than 30 days)
 */
function isCacheValid(cachedData) {
  if (!cachedData || !cachedData.cached_at) return false;
  
  const cachedDate = new Date(cachedData.cached_at);
  const now = new Date();
  const daysDiff = (now - cachedDate) / (1000 * 60 * 60 * 24);
  
  // Cache valid for 30 days
  return daysDiff < 30;
}

/**
 * Get cache statistics (for monitoring)
 */
async function getCacheStats() {
  try {
    const { sequelize } = require('../database');
    
    // Count total cached RIASEC reports
    const [riasecCount] = await sequelize.query(`
      SELECT COUNT(*) as count
      FROM interpreted_results
      WHERE riasec_report IS NOT NULL
        AND riasec_report->>'cacheKey' IS NOT NULL
        AND (riasec_report->>'cached_at')::timestamp > NOW() - INTERVAL '30 days'
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    // Count total cached interpretations
    const [interpretationCount] = await sequelize.query(`
      SELECT COUNT(*) as count
      FROM interpreted_results
      WHERE interpretation_cache_key IS NOT NULL
        AND cached_at > NOW() - INTERVAL '30 days'
    `, {
      type: sequelize.QueryTypes.SELECT
    });
    
    return {
      riasec: riasecCount?.count || 0,
      interpretation: interpretationCount?.count || 0,
      total: (riasecCount?.count || 0) + (interpretationCount?.count || 0)
    };
  } catch (error) {
    console.error('❌ Error getting cache stats:', error.message);
    return { riasec: 0, interpretation: 0, total: 0 };
  }
}

module.exports = {
  generateCacheKey,
  getCachedResponse,
  storeCachedResponse,
  isCacheValid,
  getCacheStats
};

