const { Answer, Question, Section } = require('../models');

/**
 * Calculate RIASEC scores from test attempt answers
 * @param {number} testAttemptId - Test attempt ID
 * @returns {Promise<{R: number, I: number, A: number, S: number, E: number, C: number, error: string|null}>}
 */
async function calculateRIASECScores(testAttemptId) {
  try {
    // Find RIASEC sections (5-10)
    const riasecSections = await Section.findAll({
      where: { order_index: [5, 6, 7, 8, 9, 10] },
      order: [['order_index', 'ASC']]
    });

    if (!riasecSections || riasecSections.length === 0) {
      return { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, error: 'RIASEC sections (5-10) not found' };
    }

    const sectionIds = riasecSections.map(s => s.id);
    const sectionMap = {};
    riasecSections.forEach(s => {
      sectionMap[s.order_index] = s;
    });

    // Get all answers for questions in RIASEC sections (5-10)
    const answers = await Answer.findAll({
      where: { test_attempt_id: testAttemptId },
      include: [{
        model: Question,
        as: 'question',
        where: { section_id: sectionIds },
        required: true,
        include: [{
          model: Section,
          as: 'section',
        required: true
        }]
      }]
    });

    console.log(`📊 Found ${answers.length} answers for RIASEC sections (5-10)`);

    if (!answers || answers.length === 0) {
      console.error(`❌ No answers found for RIASEC section questions in test attempt ${testAttemptId}`);
      return { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, error: 'No answers found for RIASEC section questions' };
    }

    // Map order_index to RIASEC code
    const orderToRIASEC = {
      5: 'R',
      6: 'I',
      7: 'A',
      8: 'S',
      9: 'E',
      10: 'C'
    };

    // First, ensure all questions have RIASEC categories based on their section
    console.log('🔵 Checking and assigning RIASEC categories to RIASEC section questions...');
    const riasecCodes = ['R', 'I', 'A', 'S', 'E', 'C'];
    let categoriesAssigned = 0;
    const questionIdsToUpdate = [];
    
    for (const answer of answers) {
      const question = answer.question;
      if (!question || !question.section) continue;
      
      const sectionOrderIndex = question.section.order_index;
      const riasecCode = orderToRIASEC[sectionOrderIndex];
      if (!riasecCode) continue;
      
      const currentCategory = question.category ? question.category.trim().toUpperCase() : null;
      if (!currentCategory || !['R', 'I', 'A', 'S', 'E', 'C'].includes(currentCategory)) {
        // Assign category based on section order_index
        questionIdsToUpdate.push({ id: question.id, category: riasecCode, order: question.order_index, sectionOrder: sectionOrderIndex });
      }
    }
    
    // Batch update all questions that need categories
    for (const { id, category, order, sectionOrder } of questionIdsToUpdate) {
      try {
        await Question.update(
          { category: category },
          { where: { id: id } }
        );
        console.log(`✅ Assigned category "${category}" to question ${id} (order: ${order}, section: ${sectionOrder})`);
        categoriesAssigned++;
      } catch (updateError) {
        console.error(`❌ Failed to assign category to question ${id}:`, updateError.message);
      }
    }
    
    if (categoriesAssigned > 0) {
      console.log(`✅ Assigned RIASEC categories to ${categoriesAssigned} questions`);
      // Reload all answers to get updated question data
      for (const answer of answers) {
        if (answer.question) {
          await answer.question.reload();
        }
      }
    }

    // Initialize RIASEC score accumulators
    const riasecScores = {
      R: { total: 0, count: 0 },
      I: { total: 0, count: 0 },
      A: { total: 0, count: 0 },
      S: { total: 0, count: 0 },
      E: { total: 0, count: 0 },
      C: { total: 0, count: 0 }
    };

    // Likert scale mapping: A=1, B=2, C=3, D=4, E=5
    const likertMap = { A: 1, B: 2, C: 3, D: 4, E: 5 };

    // Process each answer (categories should already be assigned above)
    let questionsWithoutCategory = [];
    for (const answer of answers) {
      const question = answer.question;
      if (!question) continue;

      // Get RIASEC category from question.category field
      // Expected values: 'R', 'I', 'A', 'S', 'E', 'C'
      let category = question.category ? question.category.trim().toUpperCase() : null;
      
      if (!category || !['R', 'I', 'A', 'S', 'E', 'C'].includes(category)) {
        questionsWithoutCategory.push(question.id);
        console.error(`❌ Question ${question.id} (order: ${question.order_index}) still has no valid RIASEC category after assignment (found: ${category || 'null'}). Skipping.`);
        continue; // Skip this question
      }
      
      console.log(`✅ Processing question ${question.id} (order: ${question.order_index}) with category: ${category}`);

      // Parse answer value
      let value;
      if (question.question_type === 'LIKERT_SCALE') {
        const answerTextUpper = answer.answer_text.trim().toUpperCase();
        if (likertMap[answerTextUpper] !== undefined) {
          value = likertMap[answerTextUpper];
        } else {
          console.warn(`⚠️ Invalid Likert answer '${answer.answer_text}' for question ${question.id}, defaulting to 3 (C)`);
          value = 3.0;
        }
      } else if (question.question_type === 'MULTIPLE_CHOICE') {
        const answerTextUpper = answer.answer_text.trim().toUpperCase();
        if (likertMap[answerTextUpper] !== undefined) {
          value = likertMap[answerTextUpper];
        } else {
          try {
            value = parseFloat(answer.answer_text);
            if (isNaN(value)) {
              value = 0.0;
            }
          } catch (e) {
            value = 0.0;
          }
        }
      } else {
        value = 0.0;
      }

      // Accumulate score for this RIASEC dimension
      if (category && riasecScores[category]) {
        riasecScores[category].total += value;
        riasecScores[category].count += 1;
      }
    }

    // Calculate average scores and convert to 0-100 scale
    // Likert scale 1-5 maps to 0-100: ((value - 1) / 4) * 100
    const result = {
      R: 0,
      I: 0,
      A: 0,
      S: 0,
      E: 0,
      C: 0,
      error: null
    };

    for (const [code, data] of Object.entries(riasecScores)) {
      if (data.count > 0) {
        const avgScore = data.total / data.count;
        // Convert 1-5 scale to 0-100 percentage
        result[code] = Math.round(((avgScore - 1) / 4) * 100 * 100) / 100; // Round to 2 decimal places
        result[code] = Math.min(100, Math.max(0, result[code])); // Clamp to 0-100
      }
    }

    // Check if we have at least some scores
    const totalCount = Object.values(riasecScores).reduce((sum, data) => sum + data.count, 0);
    if (totalCount === 0) {
      const errorDetails = {
        message: 'No valid RIASEC category questions found in RIASEC sections (5-10)',
        details: {
          totalAnswers: answers.length,
          questionsWithoutCategory: questionsWithoutCategory.length,
          sectionIds: sectionIds,
          sectionNames: riasecSections.map(s => s.name),
          questionIds: answers.map(a => a.question?.id).filter(Boolean)
        }
      };
      console.error('❌ RIASEC scoring failed:', JSON.stringify(errorDetails, null, 2));
      result.error = errorDetails.message;
    } else {
      console.log(`✅ RIASEC scores calculated: R=${result.R}, I=${result.I}, A=${result.A}, S=${result.S}, E=${result.E}, C=${result.C}`);
      console.log(`📊 Score counts: R=${riasecScores.R.count}, I=${riasecScores.I.count}, A=${riasecScores.A.count}, S=${riasecScores.S.count}, E=${riasecScores.E.count}, C=${riasecScores.C.count}`);
      if (questionsWithoutCategory.length > 0) {
        console.log(`⚠️ Skipped ${questionsWithoutCategory.length} questions without valid categories:`, questionsWithoutCategory);
      }
    }

    return result;
  } catch (error) {
    console.error('❌ Error calculating RIASEC scores:', error);
    return {
      R: 0,
      I: 0,
      A: 0,
      S: 0,
      E: 0,
      C: 0,
      error: `Failed to calculate RIASEC scores: ${error.message}`
    };
  }
}

module.exports = {
  calculateRIASECScores
};

