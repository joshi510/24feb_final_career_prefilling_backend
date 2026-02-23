const { sequelize } = require('../database');
const { Sequelize } = require('sequelize');
const { Student, TestAttempt, Answer, Question, Section, Score } = require('../models');
const { calculateRIASECScores } = require('../services/riasecScoring');

async function diagnoseStudentRIASEC(studentName) {
  try {
    console.log(`\n🔍 Diagnosing RIASEC scores for student: ${studentName}\n`);
    
    // Find student
    const student = await Student.findOne({
      where: {
        full_name: { [Sequelize.Op.like]: `%${studentName}%` }
      }
    });

    if (!student) {
      console.log(`❌ Student "${studentName}" not found`);
      return;
    }

    console.log(`✅ Found student: ${student.full_name} (ID: ${student.id})`);

    // Get latest test attempt
    const testAttempt = await TestAttempt.findOne({
      where: { student_id: student.id },
      order: [['created_at', 'DESC']]
    });

    if (!testAttempt) {
      console.log(`❌ No test attempt found for student`);
      return;
    }

    console.log(`✅ Test Attempt ID: ${testAttempt.id}`);
    console.log(`📅 Created: ${testAttempt.created_at}`);

    // Get RIASEC sections (5-10)
    const riasecSections = await Section.findAll({
      where: { order_index: [5, 6, 7, 8, 9, 10] },
      order: [['order_index', 'ASC']]
    });

    console.log(`\n📊 RIASEC Sections Found:`);
    riasecSections.forEach(s => {
      console.log(`  Section ${s.order_index}: ${s.name} (ID: ${s.id})`);
    });

    // Get all answers for RIASEC sections
    const answers = await Answer.findAll({
      where: { test_attempt_id: testAttempt.id },
      include: [{
        model: Question,
        as: 'question',
        where: { section_id: riasecSections.map(s => s.id) },
        required: true,
        include: [{
          model: Section,
          as: 'section',
          required: true
        }]
      }]
    });

    console.log(`\n📝 Total Answers Found: ${answers.length}`);

    // Group answers by section
    const answersBySection = {};
    riasecSections.forEach(s => {
      answersBySection[s.order_index] = [];
    });

    answers.forEach(answer => {
      const sectionOrder = answer.question?.section?.order_index;
      if (sectionOrder) {
        answersBySection[sectionOrder].push(answer);
      }
    });

    // Check each RIASEC dimension
    const orderToRIASEC = { 5: 'R', 6: 'I', 7: 'A', 8: 'S', 9: 'E', 10: 'C' };
    
    console.log(`\n🔍 Answer Analysis by Dimension:`);
    for (const [orderIndex, riasecCode] of Object.entries(orderToRIASEC)) {
      const sectionAnswers = answersBySection[parseInt(orderIndex)] || [];
      const questionsWithCategory = sectionAnswers.filter(a => {
        const category = a.question?.category?.trim().toUpperCase();
        return category === riasecCode;
      });
      
      console.log(`\n  ${riasecCode} (Section ${orderIndex}):`);
      console.log(`    Total answers: ${sectionAnswers.length}`);
      console.log(`    Questions with '${riasecCode}' category: ${questionsWithCategory.length}`);
      
      if (sectionAnswers.length > 0) {
        console.log(`    Sample questions:`);
        sectionAnswers.slice(0, 3).forEach(a => {
          const q = a.question;
          console.log(`      - Q${q.id} (order: ${q.order_index}): category="${q.category || 'NULL'}", answer="${a.answer_text}"`);
        });
      } else {
        console.log(`    ⚠️ NO ANSWERS FOUND for this section!`);
      }
    }

    // Calculate RIASEC scores
    console.log(`\n📊 Calculating RIASEC Scores...`);
    const riasecScores = await calculateRIASECScores(testAttempt.id);
    
    console.log(`\n✅ RIASEC Scores Result:`);
    console.log(`  R: ${riasecScores.R}%`);
    console.log(`  I: ${riasecScores.I}%`);
    console.log(`  A: ${riasecScores.A}%`);
    console.log(`  S: ${riasecScores.S}%`);
    console.log(`  E: ${riasecScores.E}%`);
    console.log(`  C: ${riasecScores.C}%`);
    
    if (riasecScores.error) {
      console.log(`\n❌ Error: ${riasecScores.error}`);
    }

    // Check overall score
    const overallScore = await Score.findOne({
      where: {
        test_attempt_id: testAttempt.id,
        dimension: 'overall'
      }
    });

    if (overallScore) {
      console.log(`\n📈 Overall Score: ${overallScore.score_value}%`);
    } else {
      console.log(`\n⚠️ No overall score found`);
    }

    // Check all scores
    const allScores = await Score.findAll({
      where: { test_attempt_id: testAttempt.id }
    });

    console.log(`\n📋 All Scores in Database:`);
    allScores.forEach(s => {
      console.log(`  ${s.dimension}: ${s.score_value}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sequelize.close();
  }
}

// Get student name from command line
const studentName = process.argv[2] || 'Ishan Kishan';
diagnoseStudentRIASEC(studentName);

