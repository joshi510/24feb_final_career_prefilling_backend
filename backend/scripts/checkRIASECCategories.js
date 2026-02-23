/**
 * Diagnostic script to check RIASEC categories for Section 5 questions
 */

const { sequelize } = require('../database');
const { Question, Section, Answer, TestAttempt } = require('../models');

async function checkRIASECCategories() {
  try {
    console.log('🔵 Checking RIASEC categories for Section 5 questions...\n');

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
    const questions = await Question.findAll({
      where: { section_id: section5.id },
      order: [['order_index', 'ASC']]
    });

    console.log(`📊 Found ${questions.length} questions in Section 5\n`);

    if (questions.length === 0) {
      console.log('⚠️ No questions found in Section 5');
      return;
    }

    // Check categories
    const riasecCodes = ['R', 'I', 'A', 'S', 'E', 'C'];
    let withCategory = 0;
    let withoutCategory = 0;

    console.log('Question Categories:');
    console.log('─'.repeat(80));
    for (const q of questions.slice(0, 20)) {
      const category = q.category ? q.category.trim().toUpperCase() : null;
      const isValid = category && riasecCodes.includes(category);
      const status = isValid ? '✅' : '❌';
      console.log(`${status} ID: ${q.id.toString().padStart(4)}, Order: ${q.order_index.toString().padStart(2)}, Category: ${(category || 'NULL').padEnd(3)} | ${q.question_text?.substring(0, 50)}...`);
      if (isValid) withCategory++;
      else withoutCategory++;
    }
    if (questions.length > 20) {
      console.log(`... and ${questions.length - 20} more questions`);
    }
    console.log('─'.repeat(80));
    console.log(`\n✅ Questions with valid RIASEC category: ${withCategory}`);
    console.log(`❌ Questions without valid category: ${withoutCategory}\n`);

    // Check distribution
    console.log('📊 Category Distribution:');
    for (const code of riasecCodes) {
      const count = questions.filter(q => q.category && q.category.trim().toUpperCase() === code).length;
      console.log(`   ${code}: ${count} questions`);
    }

    // Check recent test attempts
    console.log('\n📊 Recent Test Attempts:');
    const recentAttempts = await TestAttempt.findAll({
      where: { status: 'COMPLETED' },
      order: [['created_at', 'DESC']],
      limit: 5
    });

    for (const attempt of recentAttempts) {
      const answers = await Answer.findAll({
        where: { test_attempt_id: attempt.id },
        include: [{
          model: Question,
          as: 'question',
          where: { section_id: section5.id },
          required: true
        }]
      });

      const answersWithCategory = answers.filter(a => {
        const cat = a.question?.category?.trim().toUpperCase();
        return cat && riasecCodes.includes(cat);
      });

      console.log(`   Attempt ${attempt.id}: ${answersWithCategory.length}/${answers.length} answers have valid categories`);
    }

    console.log('\n✅ Diagnostic complete!');
  } catch (error) {
    console.error('❌ Error checking RIASEC categories:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run if called directly
if (require.main === module) {
  checkRIASECCategories()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { checkRIASECCategories };

