/**
 * Script to assign RIASEC categories to Section 5 questions
 * This assigns categories based on question order or content
 */

const { sequelize } = require('../database');
const { Question, Section } = require('../models');

async function assignRIASECCategories() {
  try {
    console.log('🔵 Starting RIASEC category assignment...');

    // Find Section 5
    const section5 = await Section.findOne({
      where: { order_index: 5 }
    });

    if (!section5) {
      console.error('❌ Section 5 not found');
      return;
    }

    console.log(`✅ Found Section 5: ${section5.name} (ID: ${section5.id})`);

    // Get all questions in Section 5
    const questions = await Question.findAll({
      where: { section_id: section5.id },
      order: [['order_index', 'ASC']]
    });

    console.log(`📊 Found ${questions.length} questions in Section 5`);

    if (questions.length === 0) {
      console.log('⚠️ No questions found in Section 5');
      return;
    }

    // RIASEC codes
    const riasecCodes = ['R', 'I', 'A', 'S', 'E', 'C'];
    
    // Assign categories - distribute evenly across questions
    let updated = 0;
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      // Cycle through RIASEC codes
      const riasecCode = riasecCodes[i % riasecCodes.length];
      
      // Only update if category is not already set to a RIASEC code
      const currentCategory = question.category ? question.category.trim().toUpperCase() : null;
      if (!currentCategory || !['R', 'I', 'A', 'S', 'E', 'C'].includes(currentCategory)) {
        await question.update({ category: riasecCode });
        console.log(`✅ Question ${question.id} (${question.order_index}): Assigned category "${riasecCode}"`);
        updated++;
      } else {
        console.log(`ℹ️ Question ${question.id} (${question.order_index}): Already has category "${currentCategory}"`);
      }
    }

    console.log(`\n✅ Updated ${updated} questions with RIASEC categories`);
    console.log('📊 Distribution:');
    
    // Show distribution
    for (const code of riasecCodes) {
      const count = await Question.count({
        where: {
          section_id: section5.id,
          category: code
        }
      });
      console.log(`   ${code}: ${count} questions`);
    }

    console.log('\n✅ RIASEC category assignment completed!');
  } catch (error) {
    console.error('❌ Error assigning RIASEC categories:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run if called directly
if (require.main === module) {
  assignRIASECCategories()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { assignRIASECCategories };

