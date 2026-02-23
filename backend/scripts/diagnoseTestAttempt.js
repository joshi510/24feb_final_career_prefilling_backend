/**
 * Diagnostic script to check a specific test attempt for RIASEC report issues
 * Usage: node scripts/diagnoseTestAttempt.js <test_attempt_id>
 */

const { sequelize } = require('../database');
const { Question, Section, Answer, TestAttempt } = require('../models');
const { calculateRIASECScores } = require('../services/riasecScoring');

async function diagnoseTestAttempt(testAttemptId) {
  try {
    console.log(`🔵 Diagnosing test attempt ${testAttemptId}...\n`);

    // Check if test attempt exists
    const testAttempt = await TestAttempt.findByPk(testAttemptId);
    if (!testAttempt) {
      console.error(`❌ Test attempt ${testAttemptId} not found`);
      return;
    }

    console.log(`✅ Found test attempt ${testAttemptId}`);
    console.log(`   Status: ${testAttempt.status}`);
    console.log(`   Student ID: ${testAttempt.student_id}`);
    console.log(`   Created: ${testAttempt.created_at}`);
    console.log(`   Completed: ${testAttempt.completed_at || 'Not completed'}\n`);

    if (testAttempt.status !== 'COMPLETED') {
      console.error(`❌ Test attempt is not completed (status: ${testAttempt.status})`);
      console.log('   RIASEC report can only be generated for completed tests.\n');
      return;
    }

    // Find Section 5
    const section5 = await Section.findOne({
      where: { order_index: 5 }
    });

    if (!section5) {
      console.error('❌ Section 5 not found');
      return;
    }

    console.log(`✅ Found Section 5: ${section5.name} (ID: ${section5.id})\n`);

    // Get all questions in Section 5
    const section5Questions = await Question.findAll({
      where: { section_id: section5.id },
      order: [['order_index', 'ASC']]
    });

    console.log(`📊 Section 5 has ${section5Questions.length} questions\n`);

    // Check categories
    const riasecCodes = ['R', 'I', 'A', 'S', 'E', 'C'];
    const questionsWithCategory = section5Questions.filter(q => {
      const cat = q.category ? q.category.trim().toUpperCase() : null;
      return cat && riasecCodes.includes(cat);
    });

    console.log(`✅ Questions with valid RIASEC categories: ${questionsWithCategory.length}/${section5Questions.length}\n`);

    if (questionsWithCategory.length === 0) {
      console.error('❌ No questions have valid RIASEC categories!');
      console.log('   Run: node scripts/assignRIASECCategories.js\n');
    }

    // Get answers for this test attempt
    const answers = await Answer.findAll({
      where: { test_attempt_id: testAttemptId },
      include: [{
        model: Question,
        as: 'question',
        where: { section_id: section5.id },
        required: true
      }]
    });

    console.log(`📊 Found ${answers.length} answers for Section 5 questions\n`);

    if (answers.length === 0) {
      console.error('❌ No answers found for Section 5 questions!');
      console.log('   This test attempt does not have any Section 5 answers.');
      console.log('   The RIASEC report cannot be generated without Section 5 answers.\n');
      return;
    }

    // Check which answers have valid categories
    const validAnswers = answers.filter(a => {
      const cat = a.question?.category?.trim().toUpperCase();
      return cat && riasecCodes.includes(cat);
    });

    console.log(`✅ Answers with valid categories: ${validAnswers.length}/${answers.length}\n`);

    if (validAnswers.length === 0) {
      console.error('❌ No answers have questions with valid RIASEC categories!');
      console.log('   The questions need to be assigned RIASEC categories.');
      console.log('   Run: node scripts/assignRIASECCategories.js\n');
      return;
    }

    // Try to calculate scores
    console.log('🔵 Attempting to calculate RIASEC scores...\n');
    const scores = await calculateRIASECScores(testAttemptId);

    if (scores.error) {
      console.error(`❌ Scoring error: ${scores.error}\n`);
    } else {
      console.log('✅ RIASEC scores calculated successfully:');
      console.log(`   R: ${scores.R}`);
      console.log(`   I: ${scores.I}`);
      console.log(`   A: ${scores.A}`);
      console.log(`   S: ${scores.S}`);
      console.log(`   E: ${scores.E}`);
      console.log(`   C: ${scores.C}\n`);

      const hasAnyScores = scores.R > 0 || scores.I > 0 || scores.A > 0 || scores.S > 0 || scores.E > 0 || scores.C > 0;
      if (!hasAnyScores) {
        console.error('⚠️ All scores are 0. This might indicate an issue with answer parsing.\n');
      } else {
        console.log('✅ Scores look good! The report should be generatable.\n');
      }
    }

    console.log('✅ Diagnostic complete!');
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Get test attempt ID from command line
const testAttemptId = process.argv[2];

if (!testAttemptId) {
  console.error('❌ Please provide a test attempt ID');
  console.log('Usage: node scripts/diagnoseTestAttempt.js <test_attempt_id>');
  process.exit(1);
}

diagnoseTestAttempt(parseInt(testAttemptId, 10))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

