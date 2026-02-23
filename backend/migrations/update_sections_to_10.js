const { Section } = require('../models');
const { sequelize } = require('../database');

async function updateSectionsTo10() {
  try {
    console.log('🔵 Starting section update migration...');
    
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Get all existing sections
    const existingSections = await Section.findAll({
      order: [['order_index', 'ASC']]
    });

    console.log(`📊 Found ${existingSections.length} existing sections`);

    // Define all 10 sections
    const allSectionsConfig = [
      { order_index: 1, name: 'Section 1: Intelligence Test (Cognitive Reasoning)', description: 'Logical Reasoning, Numerical Reasoning, Verbal Reasoning, Abstract Reasoning' },
      { order_index: 2, name: 'Section 2: Aptitude Test', description: 'Numerical Aptitude, Logical Aptitude, Verbal Aptitude, Spatial/Mechanical Aptitude' },
      { order_index: 3, name: 'Section 3: Study Habits', description: 'Concentration, Consistency, Time Management, Exam Preparedness, Self-discipline' },
      { order_index: 4, name: 'Section 4: Learning Style', description: 'Visual, Auditory, Reading/Writing, Kinesthetic' },
      { order_index: 5, name: 'Section 5: Realistic', description: 'Realistic career interests - hands-on, practical, technical' },
      { order_index: 6, name: 'Section 6: Investigative', description: 'Investigative career interests - analytical, scientific, research-oriented' },
      { order_index: 7, name: 'Section 7: Artistic', description: 'Artistic career interests - creative, expressive, innovative' },
      { order_index: 8, name: 'Section 8: Social', description: 'Social career interests - helping, teaching, supporting others' },
      { order_index: 9, name: 'Section 9: Enterprising', description: 'Enterprising career interests - leadership, business, sales' },
      { order_index: 10, name: 'Section 10: Conventional', description: 'Conventional career interests - organized, structured, detail-oriented' }
    ];

    const sectionsToCreate = [];
    const sectionsToUpdate = [];
    
    for (const config of allSectionsConfig) {
      const existingSection = existingSections.find(s => s.order_index === config.order_index);
      if (!existingSection) {
        // Section doesn't exist, create it
        sectionsToCreate.push({
          name: config.name,
          description: config.description,
          order_index: config.order_index,
          is_active: true
        });
        console.log(`➕ Will create: ${config.name}`);
      } else if (existingSection.name !== config.name || existingSection.description !== config.description) {
        // Section exists but name/description changed, update it
        sectionsToUpdate.push({
          section: existingSection,
          updates: {
            name: config.name,
            description: config.description
          }
        });
        console.log(`🔄 Will update section ${existingSection.order_index}: "${existingSection.name}" -> "${config.name}"`);
      } else {
        console.log(`✓ Section ${config.order_index} already up to date: ${config.name}`);
      }
    }

    // Update existing sections that have changed
    for (const { section, updates } of sectionsToUpdate) {
      await section.update(updates);
      console.log(`✅ Updated section ${section.order_index}: ${section.name} -> ${updates.name}`);
    }

    // Create missing sections
    if (sectionsToCreate.length > 0) {
      await Section.bulkCreate(sectionsToCreate);
      console.log(`✅ Created ${sectionsToCreate.length} missing sections`);
    }
    
    // Verify final state
    const finalSections = await Section.findAll({
      order: [['order_index', 'ASC']]
    });
    
    console.log(`\n📊 Final section count: ${finalSections.length}`);
    finalSections.forEach(s => {
      console.log(`  ${s.order_index}. ${s.name}`);
    });

    if (sectionsToCreate.length === 0 && sectionsToUpdate.length === 0) {
      console.log('\nℹ️ All 10 sections already exist and are up to date');
    } else {
      console.log(`\n✅ Migration completed! Updated ${sectionsToUpdate.length} sections, created ${sectionsToCreate.length} sections`);
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
}

// Run the migration
updateSectionsTo10();

