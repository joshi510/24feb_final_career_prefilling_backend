const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, UserRole, Student, TestAttempt, TestStatus, InterpretedResult, Score } = require('../models');
const { getCurrentUser } = require('../middleware/auth');
const { resolveTopCareerMatchForList } = require('../services/topCareerFromEngine');

/**
 * Phone for counsellor list: optional `mobile_number`, else required registration field `contact_number`.
 */
function getStudentDisplayMobile(studentRow) {
  if (!studentRow) return null;
  const raw = studentRow.mobile_number ?? studentRow.contact_number ?? null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

function normalizePhone(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

// Helper function to compute AI insight (reuse from adminStudents)
const computeAIInsight = (readinessStatus, riskLevel, score) => {
  if (!readinessStatus) {
    return 'Student has not completed the assessment yet. Encourage them to finish to get insights.';
  }
  
  const readiness = readinessStatus.toLowerCase();
  const risk = riskLevel?.toLowerCase() || 'low';
  
  if (readiness === 'ready' && risk === 'low') {
    return `Strong candidate with ${score}% score. Ready for career planning and advanced guidance.`;
  } else if (readiness === 'ready' && risk === 'medium') {
    return `Good performance (${score}%) but needs targeted support in specific areas.`;
  } else if (readiness === 'partially ready') {
    return `Moderate readiness (${score}%). Focus on building foundational skills and confidence.`;
  } else if (readiness === 'not ready' && risk === 'high') {
    return `High priority: Low score (${score}%) indicates need for immediate intervention and support.`;
  } else {
    return `Score: ${score}%. Requires personalized guidance based on readiness level.`;
  }
};

// GET /counsellor/students - Get students with test attempts for counselor
router.get('/', getCurrentUser, async (req, res) => {
  // Check if user is a counsellor
  if (req.user.role !== UserRole.COUNSELLOR) {
    return res.status(403).json({ detail: 'Access denied. Counsellor role required.' });
  }
  
  try {
    console.log('🔵 GET /counsellor/students - Request received');
    const currentUser = req.user;
    
    // Parse pagination parameters
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const offset = (page - 1) * limit;
    
    // Parse filter parameters
    const searchQuery = req.query.search || '';
    const statusFilter = req.query.status || 'all';
    const riskFilter = req.query.risk || 'all';
    
    // Validate pagination
    if (page < 1) {
      return res.status(400).json({ detail: 'Page number must be greater than 0' });
    }
    if (limit < 1 || limit > 100) {
      return res.status(400).json({ detail: 'Limit must be between 1 and 100' });
    }
    
    // Build where clause for User
    const userWhere = { role: UserRole.STUDENT };
    
    if (searchQuery) {
      userWhere[Op.or] = [
        { email: { [Op.like]: `%${searchQuery}%` } },
        { full_name: { [Op.like]: `%${searchQuery}%` } }
      ];
    }
    
    // Fetch students
    const students = await User.findAll({
      where: userWhere,
      attributes: ['id', 'email', 'full_name', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: limit * 3, // Fetch more to account for filtering
      offset: 0
    });
    
    // Get test attempts and scores for all students
    const studentsList = await Promise.all(students.map(async (student) => {
      try {
        const studentData = await Student.findOne({ where: { user_id: student.id } });
        
        // Get latest test attempt
        const latestAttempt = await TestAttempt.findOne({
          where: { student_id: student.id },
          order: [['created_at', 'DESC']]
        });
        
        let score = null;
        let readinessStatus = null;
        let riskLevel = 'LOW';
        let testAttemptId = null;
        let testStatus = null;
        let testCompletedAt = null;
        
        if (latestAttempt) {
          testAttemptId = latestAttempt.id;
          testStatus = latestAttempt.status;
          testCompletedAt = latestAttempt.completed_at;
          
          if (latestAttempt.status === TestStatus.COMPLETED) {
            // Get score
            const scoreData = await Score.findOne({
              where: {
                test_attempt_id: latestAttempt.id,
                dimension: 'overall'
              }
            });
            
            if (scoreData) {
              score = scoreData.score_value;
              
              // Calculate readiness and risk
              if (score >= 81) {
                readinessStatus = 'READY';
                riskLevel = 'LOW';
              } else if (score >= 61) {
                readinessStatus = 'PARTIALLY READY';
                riskLevel = score >= 70 ? 'LOW' : 'MEDIUM';
              } else if (score >= 31) {
                readinessStatus = 'NOT READY';
                riskLevel = 'MEDIUM';
              } else {
                readinessStatus = 'NOT READY';
                riskLevel = 'HIGH';
              }
            }
          }
        }

        let topCareerMatch = null;
        if (latestAttempt && latestAttempt.status === TestStatus.COMPLETED && testAttemptId) {
          try {
            const interpreted = await InterpretedResult.findOne({
              where: { test_attempt_id: testAttemptId },
              attributes: ['riasec_report', 'career_direction']
            });
            if (interpreted) {
              topCareerMatch = await resolveTopCareerMatchForList(
                interpreted.riasec_report,
                interpreted.career_direction
              );
            }
          } catch (topCareerErr) {
            console.warn(`⚠️ Top career match for attempt ${testAttemptId}:`, topCareerErr.message);
          }
        }

        const aiInsight = computeAIInsight(readinessStatus, riskLevel, score);

        return {
          id: student.id,
          email: student.email || null,
          full_name: student.full_name || null,
          mobile_number: getStudentDisplayMobile(studentData),
          contact_number: normalizePhone(studentData?.contact_number),
          parent_contact_number: normalizePhone(studentData?.parent_contact_number),
          education: studentData?.education || null,
          created_at: student.created_at ? new Date(student.created_at).toISOString() : null,
          has_completed_test: latestAttempt?.status === TestStatus.COMPLETED,
          test_attempt_id: testAttemptId,
          test_status: testStatus,
          test_completed_at: testCompletedAt,
          score: score,
          readiness_status: readinessStatus,
          risk_level: riskLevel,
          readiness: readinessStatus,
          risk: riskLevel,
          ai_insight: aiInsight,
          top_career_match: topCareerMatch
        };
      } catch (studentError) {
        console.error(`❌ Error processing student ${student.id}:`, studentError.message);
        return {
          id: student.id,
          email: student.email || null,
          full_name: student.full_name || null,
          mobile_number: null,
          contact_number: null,
          parent_contact_number: null,
          education: null,
          created_at: student.created_at ? new Date(student.created_at).toISOString() : null,
          has_completed_test: false,
          test_attempt_id: null,
          test_status: null,
          test_completed_at: null,
          score: null,
          readiness_status: null,
          risk_level: 'LOW',
          readiness: null,
          risk: 'LOW',
          ai_insight: 'Student has not started the assessment yet.',
          top_career_match: null
        };
      }
    }));
    
    // Apply filters
    let filteredStudentsList = studentsList;
    
    if (statusFilter !== 'all') {
      filteredStudentsList = filteredStudentsList.filter(student => {
        if (statusFilter === 'completed') {
          return student.has_completed_test;
        }
        if (statusFilter === 'in_progress') {
          return student.test_status === 'IN_PROGRESS';
        }
        if (statusFilter === 'not_started') {
          return !student.has_completed_test && student.test_status !== 'IN_PROGRESS';
        }
        return true;
      });
    }
    
    if (riskFilter !== 'all') {
      filteredStudentsList = filteredStudentsList.filter(student => {
        return student.risk_level === riskFilter.toUpperCase();
      });
    }
    
    // Apply pagination to filtered results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedStudents = filteredStudentsList.slice(startIndex, endIndex);
    
    // Calculate total records
    const totalRecordsCount = filteredStudentsList.length;
    const totalPages = Math.ceil(totalRecordsCount / limit);
    
    console.log(`✅ Successfully fetched ${paginatedStudents.length} students for counselor (page ${page} of ${totalPages})`);
    
    return res.json({
      students: paginatedStudents,
      pagination: {
        total_records: totalRecordsCount,
        total_pages: totalPages,
        current_page: page,
        limit: limit
      }
    });
  } catch (error) {
    console.error('❌ Error fetching students for counselor:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ detail: 'Failed to fetch students' });
  }
});

module.exports = router;

