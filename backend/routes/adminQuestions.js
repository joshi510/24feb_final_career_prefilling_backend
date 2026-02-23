const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { Op, Sequelize } = require('sequelize');
const { Question, QuestionType, Section, QuestionApproval, ApprovalStatus } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');
const { generateQuestions } = require('../services/geminiQuestionGenerator');

// ============================================
// EXCEL UPLOAD CONFIGURATION
// ============================================

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept both .xlsx and .csv files
    const isExcel = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                    file.originalname.endsWith('.xlsx');
    const isCSV = file.mimetype === 'text/csv' || 
                  file.mimetype === 'application/vnd.ms-excel' ||
                  file.originalname.endsWith('.csv');
    
    if (isExcel || isCSV) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx or .csv files are allowed'), false);
    }
  }
});

// ============================================
// PERFORMANCE OPTIMIZATION HELPERS
// ============================================

// Performance logging helper - logs queries taking > 200ms
const logSlowQuery = (operation, startTime, query = '') => {
  const duration = Date.now() - startTime;
  if (duration > 200) {
    console.warn(`⚠️  Slow query detected: ${operation} took ${duration}ms${query ? ` - ${query.substring(0, 100)}` : ''}`);
  }
};

// Helper to parse cursor (format: "created_at_timestamp,id")
// Used for cursor-based pagination
const parseCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const [createdAtStr, idStr] = cursor.split(',');
    const created_at = new Date(createdAtStr);
    const id = parseInt(idStr, 10);
    if (isNaN(created_at.getTime()) || isNaN(id) || id <= 0) {
      return null;
    }
    return { created_at, id };
  } catch (e) {
    return null;
  }
};

// Helper to generate cursor from question
// Use getDataValue to access raw database column (created_at) instead of Sequelize mapped attribute (createdAt)
const generateCursor = (question) => {
  if (!question || !question.id) return null;
  const created_at = question.getDataValue ? question.getDataValue('created_at') : 
                     (question.dataValues?.created_at || question.created_at);
  if (!created_at) return null;
  const dateValue = created_at instanceof Date ? created_at : new Date(created_at);
  return `${dateValue.toISOString()},${question.id}`;
};

// Auto-calculate scale_value based on question text keywords
function calculateAutoScaleValue(questionText) {
  if (!questionText || typeof questionText !== 'string') {
    return 2; // Default
  }
  
  const text = questionText.toLowerCase();
  
  // Check for scale_value = 5 keywords
  if (text.includes('always') || text.includes('strongly')) {
    return 5;
  }
  
  // Check for scale_value = 4 keywords
  if (text.includes('enjoy') || text.includes('love') || text.includes('interested')) {
    return 4;
  }
  
  // Check for scale_value = 3 keywords
  if (text.includes('like') || text.includes('comfortable') || text.includes('prefer')) {
    return 3;
  }
  
  // Check for scale_value = 2 keywords
  if (text.includes('sometimes')) {
    return 2;
  }
  
  // Default scale_value = 2
  return 2;
}

// Helper function to parse options string to array
function parseOptionsToArray(optionsString) {
  if (!optionsString) return [];
  if (Array.isArray(optionsString)) return optionsString;
  
  try {
    // Try parsing as JSON first
    const parsed = JSON.parse(optionsString);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // Not JSON, parse as comma-separated string
  }
  
  // Parse format: "A) Option 1, B) Option 2, C) Option 3"
  const options = [];
  const parts = optionsString.split(',').map(p => p.trim());
  
  for (const part of parts) {
    const match = part.match(/^([A-E])\)\s*(.+)$/i);
    if (match) {
      options.push({
        label: match[1].toUpperCase(),
        text: match[2]
      });
    } else {
      // Fallback: use the whole part
      options.push({
        label: String.fromCharCode(65 + options.length), // A, B, C, D, E
        text: part
      });
    }
  }
  
  return options;
}

// Helper function to format options array to string
function formatOptionsToString(options) {
  if (!options || !Array.isArray(options)) return '';
  return options.map((opt, index) => {
    const label = opt.label || String.fromCharCode(65 + index);
    const text = opt.text || opt;
    return `${label}) ${text}`;
  }).join(', ');
}

// GET /admin/questions/sections/list - Get all sections for dropdown
// IMPORTANT: This route must be defined BEFORE /:id and '' to avoid route conflicts
router.get('/sections/list', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const sections = await Section.findAll({
      where: { is_active: true },
      order: [['order_index', 'ASC']],
      attributes: ['id', 'name', 'order_index', 'description']
    });
    
    return res.json(sections.map(s => ({
      id: s.id,
      name: s.name,
      order_index: s.order_index,
      description: s.description || ''
    })));
  } catch (error) {
    console.error(`❌ Error in get_sections: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get sections',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /admin/questions/generate-ai - Generate AI questions
// IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
router.post('/generate-ai', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const adminUser = req.user;
    const { section_id, difficulty_level, count } = req.body;
    
    // Validation
    if (!section_id) {
      return res.status(400).json({
        detail: 'section_id is required'
      });
    }
    
    if (!difficulty_level || !['Easy', 'Medium', 'Hard'].includes(difficulty_level)) {
      return res.status(400).json({
        detail: 'difficulty_level must be Easy, Medium, or Hard'
      });
    }
    
    if (!count || count < 1 || count > 10) {
      return res.status(400).json({
        detail: 'count must be between 1 and 10'
      });
    }
    
    // Get section details
    const section = await Section.findByPk(section_id);
    if (!section) {
      return res.status(404).json({
        detail: 'Section not found'
      });
    }
    
    // Generate questions using AI
    console.log(`🤖 Generating ${count} AI questions for section: ${section.name} (${difficulty_level})`);
    const { questions: aiQuestions, error } = await generateQuestions({
      sectionName: section.name,
      sectionDescription: section.description || '',
      difficulty: difficulty_level,
      count: parseInt(count)
    });
    
    if (error || !aiQuestions || aiQuestions.length === 0) {
      console.error(`❌ AI generation failed: ${error || 'No questions generated'}`);
      console.error(`❌ Generated questions count: ${aiQuestions?.length || 0}`);
      return res.status(500).json({
        detail: error || 'Failed to generate questions',
        error: process.env.NODE_ENV === 'development' ? error : undefined
      });
    }
    
    console.log(`✅ Successfully generated ${aiQuestions.length} AI questions`);
    
    // Get max order_index for this section
    const maxOrder = await Question.max('order_index', {
      where: { section_id: section_id }
    });
    let currentOrderIndex = maxOrder ? maxOrder + 1 : 1;
    
    // Save generated questions: source='AI', status='pending', is_active=false
    const savedQuestions = [];
    for (const aiQuestion of aiQuestions) {
      try {
        // Reject or convert TEXT questions: convert TEXT to LIKERT_SCALE
        let rawQuestionType = aiQuestion.question_type ? aiQuestion.question_type.toUpperCase() : null;
        
        // Convert TEXT to LIKERT_SCALE (TEXT is not supported)
        if (rawQuestionType === 'TEXT') {
          console.log(`ℹ️ Converting TEXT question to LIKERT_SCALE: ${aiQuestion.question_text.substring(0, 50)}...`);
          rawQuestionType = 'LIKERT_SCALE';
        }
        
        // Fallback: resolve question_type with safe fallback
        const resolvedQuestionType = (rawQuestionType === 'LIKERT_SCALE') 
          ? 'LIKERT_SCALE' 
          : 'MULTIPLE_CHOICE';
        
        // Prepare question data based on type
        const questionData = {
          question_text: aiQuestion.question_text,
          question_type: resolvedQuestionType,
          section_id: section_id,
          difficulty_level: difficulty_level,
          status: 'pending', // AI questions start as pending
          source: 'AI', // AI-generated questions (explicitly set)
          is_active: 0, // AI questions are inactive until approved
          order_index: currentOrderIndex++,
          created_by: adminUser.id
        };
        
        if (resolvedQuestionType === 'LIKERT_SCALE') {
          // LIKERT_SCALE: use default Likert options, no correct_answer, auto-calculate scale_value
          questionData.options = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
          questionData.correct_answer = null;
          questionData.scale_value = calculateAutoScaleValue(aiQuestion.question_text);
        } else {
          // MULTIPLE_CHOICE: format options, include correct_answer, no scale_value
          // DO NOT call options.map for LIKERT - this is MULTIPLE_CHOICE only
          if (aiQuestion.options && Array.isArray(aiQuestion.options) && aiQuestion.options.length > 0) {
            questionData.options = aiQuestion.options.map(opt => `${opt.label}) ${opt.text}`).join(', ');
          } else {
            // Fallback: if no options provided, use default MCQ options
            questionData.options = 'A) Option A, B) Option B, C) Option C, D) Option D';
          }
          questionData.correct_answer = aiQuestion.correct_answer || 'C';
          questionData.scale_value = null;
        }
        
        const question = await Question.create(questionData);
        
        // Fetch with section info
        const savedQuestion = await Question.findOne({
          where: { id: question.id },
          include: [
            {
              model: Section,
              as: 'section',
              attributes: ['id', 'name', 'order_index'],
              required: false
            }
          ]
        });
        
        // Parse options only for MULTIPLE_CHOICE questions
        const optionsArray = savedQuestion.question_type === 'MULTIPLE_CHOICE' 
          ? parseOptionsToArray(savedQuestion.options) 
          : [];
        
        savedQuestions.push({
          id: savedQuestion.id,
          question_text: savedQuestion.question_text,
          question_type: savedQuestion.question_type,
          options: optionsArray,
          options_string: savedQuestion.options || null,
          correct_answer: savedQuestion.correct_answer || null,
          scale_value: savedQuestion.scale_value || null,
          section_id: savedQuestion.section_id,
          section: savedQuestion.section ? {
            id: savedQuestion.section.id,
            name: savedQuestion.section.name,
            order_index: savedQuestion.section.order_index
          } : null,
          difficulty_level: savedQuestion.difficulty_level || 'Medium',
          status: savedQuestion.status || 'pending',
          source: savedQuestion.source || 'ai',
          is_active: savedQuestion.is_active,
          order_index: savedQuestion.order_index,
          created_by: savedQuestion.created_by,
        created_at: (() => {
          const val = savedQuestion.getDataValue ? savedQuestion.getDataValue('created_at') : (savedQuestion.dataValues?.created_at || savedQuestion.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = savedQuestion.getDataValue ? savedQuestion.getDataValue('updated_at') : (savedQuestion.dataValues?.updated_at || savedQuestion.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
        });
      } catch (saveError) {
        console.error(`Error saving AI-generated question: ${saveError.message}`);
        // Continue with other questions
      }
    }
    
    if (savedQuestions.length === 0) {
      return res.status(500).json({
        detail: 'Failed to save generated questions'
      });
    }
    
    return res.status(201).json({
      message: `Successfully generated and saved ${savedQuestions.length} question(s)`,
      questions: savedQuestions,
      count: savedQuestions.length
    });
  } catch (error) {
    console.error(`❌ Error in generate_ai_questions: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to generate AI questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ============================================
// EXCEL UPLOAD ENDPOINT
// ============================================

// POST /admin/questions/upload-excel - Upload questions from Excel file
// IMPORTANT: This route must be defined BEFORE /:id to avoid route conflicts
router.post('/upload-excel', getCurrentUser, requireAdmin, upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const adminUser = req.user;
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        detail: 'No file uploaded. Please upload an Excel (.xlsx) or CSV (.csv) file'
      });
    }

    const isCSV = req.file.originalname.endsWith('.csv') || req.file.mimetype === 'text/csv';
    const fileType = isCSV ? 'CSV' : 'Excel';
    
    console.log(`📥 ${fileType} upload started by admin ${adminUser.id}`);
    console.log(`📄 File: ${req.file.originalname}, Size: ${req.file.size} bytes, Type: ${fileType}`);

    // Parse file (XLSX library can handle both Excel and CSV)
    let workbook;
    try {
      if (isCSV) {
        // Parse CSV file - handle different encodings
        let csvString;
        try {
          csvString = req.file.buffer.toString('utf8');
        } catch (encodingError) {
          // Try with different encoding if UTF-8 fails
          csvString = req.file.buffer.toString('latin1');
        }
        
        // XLSX.read can parse CSV directly - use CSV parsing options
        workbook = XLSX.read(csvString, { 
          type: 'string',
          codepage: 65001, // UTF-8
          cellDates: false,
          cellNF: false,
          cellText: false
        });
      } else {
        // Parse Excel file
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      }
    } catch (parseError) {
      console.error(`❌ Error parsing ${fileType} file:`, parseError.message);
      console.error('❌ Parse error stack:', parseError.stack);
      return res.status(400).json({
        detail: `Invalid ${fileType} file. Please ensure the file is a valid .${isCSV ? 'csv' : 'xlsx'} format.`,
        error: process.env.NODE_ENV === 'development' ? parseError.message : undefined
      });
    }

    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
      return res.status(400).json({
        detail: `${fileType} file is empty or has no data`
      });
    }

    // Convert sheet to JSON
    const rows = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null, // Use null for empty cells
      raw: false // Convert all values to strings
    });

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        detail: `${fileType} file contains no data rows`
      });
    }

    console.log(`📊 Found ${rows.length} rows in ${fileType} file`);

    // Expected column names (case-insensitive matching)
    const expectedColumns = ['question', 'section', 'type', 'difficulty', 'status', 'source', 'options', 'correct_answer', 'category'];
    
    // Get column mapping from first row (normalize to lowercase for matching)
    const firstRow = rows[0];
    const columnMap = {};
    const columnKeys = Object.keys(firstRow);
    
    console.log(`📋 Found columns in Excel: ${columnKeys.join(', ')}`);
    
    // Map columns (case-insensitive)
    expectedColumns.forEach(expectedCol => {
      const foundKey = columnKeys.find(key => key.toLowerCase().trim() === expectedCol.toLowerCase());
      if (foundKey) {
        columnMap[expectedCol] = foundKey;
        console.log(`✅ Mapped column: "${foundKey}" → "${expectedCol}"`);
      } else {
        console.log(`⚠️ Column not found: "${expectedCol}"`);
      }
    });

    // Validate required columns
    if (!columnMap.question) {
      return res.status(400).json({
        detail: 'Excel file must contain a "Question" column',
        found_columns: columnKeys,
        expected_columns: expectedColumns
      });
    }

    if (!columnMap.section) {
      return res.status(400).json({
        detail: 'Excel file must contain a "Section" column',
        found_columns: columnKeys,
        expected_columns: expectedColumns
      });
    }

    // Get all sections for mapping section names to IDs
    const allSections = await Section.findAll({
      attributes: ['id', 'name']
    });
    
    const sectionMap = {};
    const availableSections = [];
    allSections.forEach(section => {
      // Create map with both exact name and lowercase for case-insensitive matching
      sectionMap[section.name.toLowerCase()] = section.id;
      sectionMap[section.name] = section.id;
      availableSections.push(section.name);
    });
    
    console.log(`📚 Available sections in database: ${availableSections.join(', ')}`);

    // Status mapping (normalize to valid ENUM values)
    const statusMap = {
      'active': 'approved',
      'Active': 'approved',
      'ACTIVE': 'approved',
      'approved': 'approved',
      'Approved': 'approved',
      'APPROVED': 'approved',
      'pending': 'pending',
      'Pending': 'pending',
      'PENDING': 'pending',
      'rejected': 'rejected',
      'Rejected': 'rejected',
      'REJECTED': 'rejected',
      'inactive': 'inactive',
      'Inactive': 'inactive',
      'INACTIVE': 'inactive'
    };

    // Source mapping (normalize to valid ENUM values)
    const sourceMap = {
      'admin': 'ADMIN',
      'Admin': 'ADMIN',
      'ADMIN': 'ADMIN',
      'ai': 'AI',
      'AI': 'AI',
      'Ai': 'AI'
    };

    // Type mapping (normalize to valid ENUM values)
    const typeMap = {
      'multiple_choice': 'MULTIPLE_CHOICE',
      'Multiple Choice': 'MULTIPLE_CHOICE',
      'MULTIPLE_CHOICE': 'MULTIPLE_CHOICE',
      'MCQ': 'MULTIPLE_CHOICE',
      'likert_scale': 'LIKERT_SCALE',
      'Likert Scale': 'LIKERT_SCALE',
      'LIKERT_SCALE': 'LIKERT_SCALE',
      'Likert': 'LIKERT_SCALE'
    };

    // Difficulty mapping
    const difficultyMap = {
      'easy': 'Easy',
      'Easy': 'Easy',
      'EASY': 'Easy',
      'medium': 'Medium',
      'Medium': 'Medium',
      'MEDIUM': 'Medium',
      'hard': 'Hard',
      'Hard': 'Hard',
      'HARD': 'Hard'
    };

    // Process rows and prepare questions for insertion
    const questionsToInsert = [];
    const errors = [];
    let skippedCount = 0;
    let processedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because Excel rows start at 1 and we have header row
      
      try {
        // Get question text
        const questionText = row[columnMap.question];
        
        // Skip empty question rows
        if (!questionText || typeof questionText !== 'string' || !questionText.trim()) {
          skippedCount++;
          continue;
        }

        processedCount++;

        // Get section name and find section ID
        const sectionName = row[columnMap.section];
        if (!sectionName || (typeof sectionName === 'string' && !sectionName.trim())) {
          errors.push(`Row ${rowNum}: Section is required or empty`);
          console.log(`❌ Row ${rowNum}: Missing section`);
          continue;
        }

        // Normalize section name (trim and handle string conversion)
        const normalizedSectionName = typeof sectionName === 'string' ? sectionName.trim() : String(sectionName).trim();
        
        // Find section ID (case-insensitive)
        const sectionId = sectionMap[normalizedSectionName] || sectionMap[normalizedSectionName?.toLowerCase()];
        if (!sectionId) {
          const errorMsg = `Row ${rowNum}: Section "${normalizedSectionName}" not found. Available sections: ${availableSections.join(', ')}`;
          errors.push(errorMsg);
          console.log(`❌ ${errorMsg}`);
          continue;
        }

        // Get and normalize question type
        const typeValue = row[columnMap.type] || 'LIKERT_SCALE'; // Default to LIKERT_SCALE
        const questionType = typeMap[typeValue] || typeMap[typeValue?.toLowerCase()] || 'LIKERT_SCALE';

        // Get and normalize difficulty
        const difficultyValue = row[columnMap.difficulty] || 'Medium';
        const difficulty = difficultyMap[difficultyValue] || difficultyMap[difficultyValue?.toLowerCase()] || 'Medium';

        // Get and normalize status
        const statusValue = row[columnMap.status] || 'approved';
        const status = statusMap[statusValue] || statusMap[statusValue?.toLowerCase()] || 'approved';

        // Get and normalize source
        const sourceValue = row[columnMap.source] || 'ADMIN';
        const source = sourceMap[sourceValue] || sourceMap[sourceValue?.toLowerCase()] || 'ADMIN';

        // Get category (for Section 5, this should be R, I, A, S, E, or C)
        let category = null;
        if (columnMap.category && row[columnMap.category]) {
          const categoryValue = String(row[columnMap.category]).trim().toUpperCase();
          // For Section 5, validate RIASEC codes
          if (sectionName.toLowerCase().includes('riasec') || sectionName.toLowerCase().includes('career interest')) {
            if (['R', 'I', 'A', 'S', 'E', 'C'].includes(categoryValue)) {
              category = categoryValue;
            } else {
              console.warn(`Row ${rowNum}: Invalid RIASEC category "${categoryValue}" for Section 5, skipping category`);
            }
          } else {
            // For other sections, allow any category string
            category = categoryValue;
          }
        }

        // Prepare question data
        const questionData = {
          question_text: questionText.trim(),
          question_type: questionType,
          section_id: sectionId,
          difficulty_level: difficulty,
          status: status,
          source: source,
          is_active: status === 'approved', // Active only if approved
          created_by: adminUser.id
        };

        // Set category if provided
        if (category) {
          questionData.category = category;
        }

        // Set options and scale_value based on question type
        if (questionType === 'LIKERT_SCALE') {
          questionData.options = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
          questionData.correct_answer = null;
          questionData.scale_value = calculateAutoScaleValue(questionText);
        } else {
          // MULTIPLE_CHOICE - get options and correct_answer from Excel if provided
          const optionsValue = row[columnMap.options];
          const correctAnswerValue = row[columnMap.correct_answer];
          
          if (optionsValue && typeof optionsValue === 'string' && optionsValue.trim()) {
            // Parse options from Excel
            // Format can be: "A) Option 1, B) Option 2, C) Option 3, D) Option 4"
            // Or pipe-separated: "A) 24|B) 32|C) 28|D) 30"
            // Or: "Option 1, Option 2, Option 3, Option 4" (will auto-add A, B, C, D)
            let optionsString = optionsValue.trim();
            
            // Check if it's pipe-separated and convert to comma-separated for consistency
            if (optionsString.includes('|')) {
              // Convert pipe-separated to comma-separated
              optionsString = optionsString.split('|').map(opt => opt.trim()).join(', ');
            }
            
            // If options don't have labels (A, B, C, D), add them
            if (!optionsString.match(/^[A-E]\)/i)) {
              const optionsArray = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt);
              if (optionsArray.length >= 4) {
                optionsString = optionsArray.map((opt, idx) => {
                  const label = String.fromCharCode(65 + idx); // A, B, C, D
                  return `${label}) ${opt}`;
                }).join(', ');
              }
            }
            
            questionData.options = optionsString;
          } else {
            // Default options if not provided
            questionData.options = 'A) Option A, B) Option B, C) Option C, D) Option D';
          }
          
          // Set correct answer
          if (correctAnswerValue && typeof correctAnswerValue === 'string') {
            const answer = correctAnswerValue.trim().toUpperCase();
            if (['A', 'B', 'C', 'D'].includes(answer)) {
              questionData.correct_answer = answer;
            } else {
              questionData.correct_answer = 'C'; // Default if invalid
              console.warn(`Row ${rowNum}: Invalid correct_answer "${correctAnswerValue}", defaulting to "C"`);
            }
          } else {
            questionData.correct_answer = 'C'; // Default
          }
          
          questionData.scale_value = null;
        }

        questionsToInsert.push(questionData);
      } catch (rowError) {
        errors.push(`Row ${rowNum}: ${rowError.message}`);
        console.error(`❌ Error processing row ${rowNum}:`, rowError);
      }
    }

    if (questionsToInsert.length === 0) {
      // Provide detailed error information
      const errorDetails = {
        detail: 'No valid questions found in Excel file',
        summary: {
          total_rows: rows.length,
          processed: processedCount,
          skipped: skippedCount,
          errors_count: errors.length
        },
        errors: errors.length > 0 ? errors.slice(0, 20) : undefined, // Show first 20 errors
        available_sections: availableSections,
        found_columns: columnKeys,
        column_mapping: columnMap,
        suggestions: []
      };

      // Add helpful suggestions
      if (skippedCount === rows.length) {
        errorDetails.suggestions.push('All rows were skipped. Please ensure the "Question" column has non-empty values.');
      }
      if (errors.some(e => e.includes('Section'))) {
        errorDetails.suggestions.push(`Make sure section names in Excel match one of these: ${availableSections.join(', ')}`);
      }
      if (processedCount === 0) {
        errorDetails.suggestions.push('No rows were processed. Check that Question and Section columns have valid data.');
      }

      console.error('❌ No valid questions found:', errorDetails);
      return res.status(400).json(errorDetails);
    }

    // Get max order_index for each section to set proper order_index
    const sectionOrderIndices = {};
    for (const q of questionsToInsert) {
      if (!sectionOrderIndices[q.section_id]) {
        const maxOrder = await Question.max('order_index', {
          where: { section_id: q.section_id }
        });
        sectionOrderIndices[q.section_id] = maxOrder ? maxOrder + 1 : 1;
      }
    }

    // Set order_index for each question
    questionsToInsert.forEach(q => {
      q.order_index = sectionOrderIndices[q.section_id]++;
    });

    // Insert questions in batches (100 at a time for better performance)
    const batchSize = 100;
    let insertedCount = 0;
    const insertErrors = [];

    for (let i = 0; i < questionsToInsert.length; i += batchSize) {
      const batch = questionsToInsert.slice(i, i + batchSize);
      try {
        await Question.bulkCreate(batch, {
          validate: true,
          individualHooks: false
        });
        insertedCount += batch.length;
      } catch (batchError) {
        console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, batchError.message);
        insertErrors.push(`Batch ${i / batchSize + 1}: ${batchError.message}`);
        
        // Try inserting individually to identify problematic rows
        for (const question of batch) {
          try {
            await Question.create(question);
            insertedCount++;
          } catch (individualError) {
            insertErrors.push(`Question "${question.question_text.substring(0, 50)}...": ${individualError.message}`);
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Excel upload completed in ${duration}ms`);
    console.log(`📊 Summary: ${insertedCount} inserted, ${skippedCount} skipped, ${errors.length} validation errors`);

    return res.status(200).json({
      message: `Successfully uploaded ${insertedCount} question(s) from Excel file`,
      summary: {
        total_rows: rows.length,
        processed: processedCount,
        inserted: insertedCount,
        skipped: skippedCount,
        validation_errors: errors.length,
        insert_errors: insertErrors.length
      },
      errors: errors.length > 0 ? errors.slice(0, 50) : undefined, // Limit to first 50 errors
      insert_errors: insertErrors.length > 0 ? insertErrors.slice(0, 50) : undefined
    });

  } catch (error) {
    console.error(`❌ Error in file upload: ${error.message}`);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error stack:', error.stack);
    
    // Provide more detailed error information
    let errorDetail = 'Failed to process file';
    if (error.message) {
      errorDetail = error.message;
    }
    
    return res.status(500).json({
      detail: errorDetail,
      error: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 5).join('\n') // First 5 lines of stack
      } : undefined
    });
  }
});

// GET /admin/questions - Get all questions with filters (optimized with cursor pagination)
// Server-side pagination using findAndCountAll
router.get('/', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const { 
      page = 1,
      limit = 25,
      section_id, 
      status, 
      question_type,
      search,
      only_pending 
    } = req.query;
    
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(Math.max(1, parseInt(limit) || 25), 100); // Min 1, Max 100 per page
    const offset = (pageNum - 1) * limitNum;
    
    // Build where clause - only use columns that exist in database
    const where = {};
    
    // only_pending filter (overrides status filter)
    if (only_pending === 'true') {
      where.status = 'pending';
      where.is_active = false;
    } else if (status) {
      // Status filter when only_pending is false
      if (status === 'active' || status === 'approved') {
        where.status = 'approved';
        where.is_active = true;
      } else if (status === 'inactive') {
        where.status = 'inactive';
        where.is_active = false;
      } else if (status === 'pending') {
        where.status = 'pending';
        // Don't filter by is_active for pending status
      } else if (status === 'rejected') {
        where.status = 'rejected';
        // Don't filter by is_active for rejected status
      } else {
        where.status = status;
      }
    }
    
    // These filters apply regardless of only_pending
    if (section_id) {
      const sectionIdNum = parseInt(section_id);
      if (!isNaN(sectionIdNum)) {
        where.section_id = sectionIdNum;
      }
    }
    if (question_type) {
      where.question_type = question_type;
    }
    // Note: difficulty_level column doesn't exist in DB, so we skip this filter
    
    // Full-text search
    if (search) {
      where.question_text = {
        [Op.like]: `%${search}%`
      };
    }
    
    // Query options
    const queryOptions = {
      where,
      attributes: [
        'id', 'question_text', 'question_type', 'options', 'correct_answer',
        'section_id', 'status', 'source', 'is_active',
        'order_index', 'created_by', 'difficulty_level', 'created_at', 'updated_at'
      ],
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ],
      order: [
        ['is_active', 'DESC'], // Active questions first
        [Sequelize.literal("CASE WHEN status = 'approved' THEN 1 ELSE 0 END"), 'DESC'], // Approved before unapproved
        ['order_index', 'ASC'] // Then by order_index ascending
      ],
      limit: limitNum,
      offset: offset,
      distinct: true, // Important for accurate count with JOINs
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    };
    
    // Execute query with count
    const { rows: questions, count: totalRecords } = await Question.findAndCountAll(queryOptions);
    
    const totalPages = Math.ceil(totalRecords / limitNum);
    
    // Format response
    const questionsList = questions.map(q => {
      const options = parseOptionsToArray(q.options);
      // Get difficulty_level - try multiple access methods for compatibility
      let difficultyLevel = null;
      if (q.getDataValue) {
        difficultyLevel = q.getDataValue('difficulty_level');
      } else if (q.dataValues && q.dataValues.difficulty_level !== undefined) {
        difficultyLevel = q.dataValues.difficulty_level;
      } else if (q.difficulty_level !== undefined) {
        difficultyLevel = q.difficulty_level;
      }
      
      return {
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: options,
        options_string: q.options,
        correct_answer: q.correct_answer,
        section_id: q.section_id,
        section: q.section ? {
          id: q.section.id,
          name: q.section.name,
          order_index: q.section.order_index
        } : null,
        status: q.status || 'approved',
        source: q.source || 'ADMIN',
        is_active: (() => {
          // Get raw value from database
          const rawValue = q.getDataValue ? q.getDataValue('is_active') : (q.dataValues?.is_active ?? q.is_active);
          // Convert to boolean: true if 1, true, or '1', false otherwise
          return rawValue === true || rawValue === 1 || rawValue === '1';
        })(),
        order_index: q.order_index || 0,
        difficulty_level: difficultyLevel || 'Medium',
        created_by: q.created_by || null,
        created_at: (() => {
          const val = q.getDataValue ? q.getDataValue('created_at') : (q.dataValues?.created_at || q.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = q.getDataValue ? q.getDataValue('updated_at') : (q.dataValues?.updated_at || q.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
      };
    });
    
    logSlowQuery('get_questions', startTime);
    
    // Response format with pagination metadata
    return res.json({
      questions: questionsList,
      pagination: {
        total_records: totalRecords,
        total_pages: totalPages,
        current_page: pageNum,
        limit: limitNum,
        has_previous: pageNum > 1,
        has_next: pageNum < totalPages
      }
    });
  } catch (error) {
    logSlowQuery('get_questions_error', startTime);
    console.error(`❌ Error in get_questions: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to get questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// GET /admin/questions/:id - Get single question
router.get('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId)) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    const question = await Question.findOne({
      where: { id: questionId },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    const options = parseOptionsToArray(question.options);
    
    return res.json({
      id: question.id,
      question_text: question.question_text,
      question_type: question.question_type,
      options: options,
      options_string: question.options,
      correct_answer: question.correct_answer,
      scale_value: question.scale_value || null,
      section_id: question.section_id,
      section: question.section ? {
        id: question.section.id,
        name: question.section.name,
        order_index: question.section.order_index
      } : null,
        difficulty_level: question.difficulty_level || 'Medium',
        status: question.status || 'pending',
        source: question.source || 'ADMIN',
        is_active: question.is_active,
        order_index: question.order_index,
        created_by: question.created_by || null,
        created_at: (() => {
          const val = question.getDataValue ? question.getDataValue('created_at') : (question.dataValues?.created_at || question.created_at);
          return val ? new Date(val).toISOString() : null;
        })(),
        updated_at: (() => {
          const val = question.getDataValue ? question.getDataValue('updated_at') : (question.dataValues?.updated_at || question.updated_at);
          return val ? new Date(val).toISOString() : null;
        })()
    });
  } catch (error) {
    console.error(`❌ Error in get_question: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions - Create new question
router.post('', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const adminUser = req.user;
    
    // Log incoming request for debugging
    console.log('📥 POST /admin/questions - Request body:', JSON.stringify(req.body, null, 2));
    
    const {
      question_text,
      question_type,
      options,
      correct_answer,
      scale_value, // Ignored - will be auto-calculated
      section_id,
      difficulty_level,
      status
      // order_index is auto-generated, ignore if provided
    } = req.body;
    
    // Validation
    if (!question_text || !question_text.trim()) {
      return res.status(400).json({
        detail: 'question_text is required'
      });
    }
    
    if (!question_type || !['MULTIPLE_CHOICE', 'LIKERT_SCALE'].includes(question_type)) {
      return res.status(400).json({
        detail: 'question_type must be MULTIPLE_CHOICE or LIKERT_SCALE'
      });
    }
    
    if (question_type === 'MULTIPLE_CHOICE' && !options) {
      return res.status(400).json({
        detail: 'options are required for MULTIPLE_CHOICE questions'
      });
    }
    
    if (question_type === 'MULTIPLE_CHOICE' && !correct_answer) {
      return res.status(400).json({
        detail: 'correct_answer is required for MULTIPLE_CHOICE questions'
      });
    }
    
    if (!section_id) {
      console.error('❌ Validation failed: section_id is required');
      return res.status(400).json({
        detail: 'section_id is required'
      });
    }
    
    // Verify section exists
    const section = await Section.findByPk(section_id);
    if (!section) {
      console.error('❌ Validation failed: Section not found:', section_id);
      return res.status(404).json({
        detail: 'Section not found'
      });
    }
    
    // NOTE: scale_value is NOT required - it will be auto-calculated for LIKERT_SCALE
    // Frontend should NOT send scale_value, but if it does, we ignore it
    console.log('✅ All validations passed. Proceeding with question creation...');
    
    // Format options
    let optionsString = '';
    if (Array.isArray(options)) {
      // For LIKERT_SCALE, ensure we have valid options
      if (question_type === 'LIKERT_SCALE' && options.length > 0) {
        optionsString = formatOptionsToString(options);
      } else if (question_type === 'LIKERT_SCALE') {
        // Default Likert options if not provided
        optionsString = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
      } else {
        optionsString = formatOptionsToString(options);
      }
    } else if (typeof options === 'string') {
      optionsString = options;
    } else if (question_type === 'LIKERT_SCALE' && !options) {
      // Default Likert options if options is missing
      optionsString = 'A) Strongly Disagree, B) Disagree, C) Neutral, D) Agree, E) Strongly Agree';
    }
    
    // AUTO-CALCULATE scale_value from question_text (backend safety: ignore frontend input)
    // For LIKERT_SCALE questions, scale_value is ALWAYS auto-calculated
    // For other types, scale_value is null
    let autoScaleValue = null;
    if (question_type === 'LIKERT_SCALE') {
      autoScaleValue = calculateAutoScaleValue(question_text);
      // Ensure we have a valid scale_value (should always be 2-5)
      if (!autoScaleValue || autoScaleValue < 2 || autoScaleValue > 5) {
        console.warn(`⚠️ Auto-calculated scale_value is invalid: ${autoScaleValue}, defaulting to 2`);
        autoScaleValue = 2;
      }
      console.log(`✅ Auto-calculated scale_value for LIKERT question: ${autoScaleValue} (from: "${question_text.substring(0, 50)}...")`);
    }
    
    // Admin-created questions: source='ADMIN', status='approved', is_active=true
    // Validate and normalize status - map invalid values to valid ones
    let finalStatus = status || 'approved';
    // Map common invalid status values to valid ENUM values
    const statusMap = {
      'active': 'approved',
      'Active': 'approved',
      'ACTIVE': 'approved',
      'inactive': 'inactive',
      'Inactive': 'inactive',
      'INACTIVE': 'inactive',
      'pending': 'pending',
      'Pending': 'pending',
      'PENDING': 'pending',
      'approved': 'approved',
      'Approved': 'approved',
      'APPROVED': 'approved',
      'rejected': 'rejected',
      'Rejected': 'rejected',
      'REJECTED': 'rejected'
    };
    
    // Normalize status to lowercase for mapping, then use mapped value or default to 'approved'
    if (statusMap[finalStatus]) {
      finalStatus = statusMap[finalStatus];
    } else if (!['pending', 'approved', 'rejected', 'inactive'].includes(finalStatus)) {
      // If status is not in valid ENUM values, default to 'approved'
      console.warn(`⚠️ Invalid status "${status}" provided, defaulting to "approved"`);
      finalStatus = 'approved';
    }
    
    const finalSource = 'ADMIN'; // Always ADMIN for manual creation
    const isActive = true;
    
    // Auto-increment order_index for this section
    const maxOrder = await Question.max('order_index', {
      where: { section_id: section_id }
    });
    const finalOrderIndex = maxOrder ? maxOrder + 1 : 1;
    
    // Prepare create data - ensure scale_value is set correctly for LIKERT_SCALE
    const createData = {
      question_text: question_text.trim(),
      question_type: question_type,
      options: optionsString,
      correct_answer: correct_answer || null,
      section_id: section_id,
      difficulty_level: difficulty_level || 'Medium',
      status: finalStatus, // 'approved' for admin-created questions
      source: finalSource, // 'ADMIN'
      is_active: true, // Use boolean for PostgreSQL BOOLEAN type
      order_index: finalOrderIndex,
      created_by: adminUser.id
    };
    
    // Set scale_value ONLY for LIKERT_SCALE questions (auto-calculated, always 2-5)
    // For other types, explicitly set to null (database allows null)
    if (question_type === 'LIKERT_SCALE') {
      createData.scale_value = autoScaleValue; // Auto-calculated value (2-5, guaranteed by validation above)
    } else {
      createData.scale_value = null; // Explicitly null for non-LIKERT questions
    }
    
    console.log(`📝 Creating ${question_type} question with scale_value:`, createData.scale_value);
    
    // Create question - explicitly set is_active to true (use 1 for MySQL TINYINT compatibility)
    const question = await Question.create(createData, {
      // Ensure we return the created instance with all fields
      returning: true
    });
    
    // Verify what was saved
    const savedIsActive = question.getDataValue('is_active');
    console.log('✅ Created question ID:', question.id);
    console.log('✅ Created question - is_active from instance:', question.is_active, 'type:', typeof question.is_active);
    console.log('✅ Created question - is_active from getDataValue:', savedIsActive, 'type:', typeof savedIsActive);
    
    // If somehow it's false, update it immediately
    if (savedIsActive === 0 || savedIsActive === false) {
      console.warn('⚠️ WARNING: is_active was saved as 0/false, updating to true');
      await question.update({ is_active: true });
    }
    
    // Fetch with section info
    const createdQuestion = await Question.findOne({
      where: { id: question.id },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    // Get is_active value using getDataValue to ensure we get the raw DB value
    const isActiveValue = createdQuestion.getDataValue ? createdQuestion.getDataValue('is_active') : (createdQuestion.dataValues?.is_active ?? createdQuestion.is_active);
    // Convert to boolean: true if 1, true, or '1', false otherwise
    const isActiveBoolean = isActiveValue === true || isActiveValue === 1 || isActiveValue === '1';
    
    console.log('✅ Fetched question - is_active raw:', isActiveValue, 'type:', typeof isActiveValue);
    console.log('✅ Fetched question - is_active boolean:', isActiveBoolean);
    console.log('✅ Fetched question - full dataValues:', JSON.stringify(createdQuestion.dataValues, null, 2));
    
    const optionsArray = parseOptionsToArray(createdQuestion.options);
    
    return res.status(201).json({
      id: createdQuestion.id,
      question_text: createdQuestion.question_text,
      question_type: createdQuestion.question_type,
      options: optionsArray,
      options_string: createdQuestion.options,
      correct_answer: createdQuestion.correct_answer,
      scale_value: createdQuestion.scale_value || null,
      section_id: createdQuestion.section_id,
      section: createdQuestion.section ? {
        id: createdQuestion.section.id,
        name: createdQuestion.section.name,
        order_index: createdQuestion.section.order_index
      } : null,
      difficulty_level: createdQuestion.difficulty_level || 'Medium',
      status: createdQuestion.status || 'approved',
      source: createdQuestion.source || 'ADMIN',
      is_active: isActiveBoolean, // Explicitly convert to boolean
      order_index: createdQuestion.order_index,
      created_by: createdQuestion.created_by,
      created_at: (() => {
        const val = createdQuestion.getDataValue ? createdQuestion.getDataValue('created_at') : (createdQuestion.dataValues?.created_at || createdQuestion.created_at);
        return val ? new Date(val).toISOString() : null;
      })(),
      updated_at: (() => {
        const val = createdQuestion.getDataValue ? createdQuestion.getDataValue('updated_at') : (createdQuestion.dataValues?.updated_at || createdQuestion.updated_at);
        return val ? new Date(val).toISOString() : null;
      })()
    });
  } catch (error) {
    console.error(`❌ Error in create_question: ${error.message}`);
    console.error('❌ Error name:', error.name);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body was:', JSON.stringify(req.body, null, 2));
    
    // If it's a validation error, return 400
    if (error.name === 'SequelizeValidationError' || error.name === 'ValidationError') {
      return res.status(400).json({
        detail: error.message || 'Validation error',
        errors: error.errors || undefined
      });
    }
    
    return res.status(500).json({
      detail: 'Failed to create question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /admin/questions/:id - Update question
router.put('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId)) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    const question = await Question.findByPk(questionId);
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    const {
      question_text,
      question_type,
      options,
      correct_answer,
      scale_value,
      section_id,
      difficulty_level,
      status,
      order_index
    } = req.body;
    
    // Validation
    if (question_text !== undefined && !question_text.trim()) {
      return res.status(400).json({
        detail: 'question_text cannot be empty'
      });
    }
    
    if (question_type && !['MULTIPLE_CHOICE', 'LIKERT_SCALE'].includes(question_type)) {
      return res.status(400).json({
        detail: 'question_type must be MULTIPLE_CHOICE or LIKERT_SCALE'
      });
    }
    
    if (section_id) {
      const section = await Section.findByPk(section_id);
      if (!section) {
        return res.status(404).json({
          detail: 'Section not found'
        });
      }
    }
    
    // Build update object
    const updateData = {};
    
    if (question_text !== undefined) {
      updateData.question_text = question_text.trim();
    }
    
    if (question_type !== undefined) {
      updateData.question_type = question_type;
    }
    
    if (options !== undefined) {
      if (Array.isArray(options)) {
        updateData.options = formatOptionsToString(options);
      } else if (typeof options === 'string') {
        updateData.options = options;
      }
    }
    
    if (correct_answer !== undefined) {
      updateData.correct_answer = correct_answer;
    }
    
    // AUTO-CALCULATE scale_value if question_text is updated (backend safety: ignore frontend input)
    if (question_text !== undefined) {
      const finalQuestionType = question_type !== undefined ? question_type : question.question_type;
      if (finalQuestionType === 'LIKERT_SCALE') {
        updateData.scale_value = calculateAutoScaleValue(question_text);
      }
    } else if (question_type !== undefined && question_type === 'LIKERT_SCALE') {
      // If only question_type changed to LIKERT_SCALE, recalculate from existing question_text
      updateData.scale_value = calculateAutoScaleValue(question.question_text);
    }
    
    if (section_id !== undefined) {
      updateData.section_id = section_id;
    }
    
    if (difficulty_level !== undefined) {
      updateData.difficulty_level = difficulty_level;
    }
    
    if (status !== undefined) {
      updateData.status = status;
      // Update is_active based on status (only approved questions are active)
      updateData.is_active = status === 'approved';
    }
    
    if (order_index !== undefined) {
      updateData.order_index = order_index;
    }
    
    // Update question
    await question.update(updateData);
    
    // Fetch updated question with section info
    const updatedQuestion = await Question.findOne({
      where: { id: questionId },
      include: [
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'order_index'],
          required: false
        }
      ]
    });
    
    const optionsArray = parseOptionsToArray(updatedQuestion.options);
    
    return res.json({
      id: updatedQuestion.id,
      question_text: updatedQuestion.question_text,
      question_type: updatedQuestion.question_type,
      options: optionsArray,
      options_string: updatedQuestion.options,
      correct_answer: updatedQuestion.correct_answer,
      scale_value: updatedQuestion.scale_value || null,
      section_id: updatedQuestion.section_id,
      section: updatedQuestion.section ? {
        id: updatedQuestion.section.id,
        name: updatedQuestion.section.name,
        order_index: updatedQuestion.section.order_index
      } : null,
      difficulty_level: updatedQuestion.difficulty_level || 'Medium',
      status: updatedQuestion.status || 'pending',
      source: updatedQuestion.source || 'ADMIN',
      is_active: updatedQuestion.is_active,
      order_index: updatedQuestion.order_index,
      created_by: updatedQuestion.created_by || null,
      created_at: (() => {
        const val = updatedQuestion.getDataValue ? updatedQuestion.getDataValue('created_at') : (updatedQuestion.dataValues?.created_at || updatedQuestion.created_at);
        return val ? new Date(val).toISOString() : null;
      })(),
      updated_at: (() => {
        const val = updatedQuestion.getDataValue ? updatedQuestion.getDataValue('updated_at') : (updatedQuestion.dataValues?.updated_at || updatedQuestion.updated_at);
        return val ? new Date(val).toISOString() : null;
      })()
    });
  } catch (error) {
    console.error(`❌ Error in update_question: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to update question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// DELETE /admin/questions/:id - Soft delete question (set status to Inactive)
router.delete('/:id', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        status: 'inactive',
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question deleted successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in delete_question:', error);
    return res.status(500).json({
      detail: 'Failed to delete question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /admin/questions/:id/activate - Activate question
router.patch('/:id/activate', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        is_active: true
      },
      {
        where: { id: questionId },
        fields: ['is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question activated successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in activate_question:', error);
    return res.status(500).json({
      detail: 'Failed to activate question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PATCH /admin/questions/:id/deactivate - Deactivate question
router.patch('/:id/deactivate', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({ detail: 'Invalid question ID' });
    }
    
    const [updatedCount] = await Question.update(
      {
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({ detail: 'Question not found' });
    }
    
    return res.json({
      message: 'Question deactivated successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in deactivate_question:', error);
    return res.status(500).json({
      detail: 'Failed to deactivate question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/:id/approve - Approve a question
router.post('/:id/approve', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    const adminUser = req.user;
    const { admin_comment } = req.body;
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    // Check if question exists and is active
    const question = await Question.findOne({
      where: { id: questionId },
      attributes: ['id', 'is_active', 'status']
    });
    
    if (!question) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Update question: set status='approved' and is_active=true (for AI questions)
    const [updatedCount] = await Question.update(
      {
        status: 'approved', // Approve the question
        is_active: 1 // Activate the question
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(400).json({
        detail: 'Question is not active and cannot be approved'
      });
    }
    
    // Create approval record
    await QuestionApproval.create({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.APPROVED,
      admin_comment: admin_comment || null
    });
    
    return res.json({
      message: 'Question approved successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in approve_question:', error);
    return res.status(500).json({
      detail: 'Failed to approve question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/:id/reject - Reject a question
router.post('/:id/reject', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const questionId = parseInt(req.params.id, 10);
    const adminUser = req.user;
    const { admin_comment } = req.body;
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    if (!admin_comment || !admin_comment.trim()) {
      return res.status(400).json({
        detail: 'admin_comment is required when rejecting a question'
      });
    }
    
    // Check if question exists
    const questionExists = await Question.findOne({
      where: { id: questionId },
      attributes: ['id']
    });
    
    if (!questionExists) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Update question status using direct update (avoids scale_value column issue)
    const [updatedCount] = await Question.update(
      {
        status: 'rejected',
        is_active: false
      },
      {
        where: { id: questionId },
        fields: ['status', 'is_active']
      }
    );
    
    if (updatedCount === 0) {
      return res.status(404).json({
        detail: 'Question not found'
      });
    }
    
    // Create approval record
    await QuestionApproval.create({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.REJECTED,
      admin_comment: admin_comment.trim()
    });
    
    return res.json({
      message: 'Question rejected successfully',
      id: questionId
    });
  } catch (error) {
    console.error('❌ Error in reject_question:', error);
    return res.status(500).json({
      detail: 'Failed to reject question',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /admin/questions/bulk-approve - Bulk approve questions (optimized with batch operations)
// IMPORTANT: This route must be defined BEFORE /:id routes to avoid route conflicts
router.post('/bulk-approve', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const transaction = await Question.sequelize.transaction();
  
  try {
    const adminUser = req.user;
    const { question_ids, admin_comment } = req.body;
    
    // Validation
    if (!question_ids || !Array.isArray(question_ids) || question_ids.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'question_ids must be a non-empty array'
      });
    }
    
    // Limit bulk operations to prevent performance issues
    if (question_ids.length > 1000) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'Maximum 1000 questions can be approved at once'
      });
    }
    
    // Validate all IDs are numbers
    const validIds = question_ids
      .map(id => parseInt(id, 10))
      .filter(id => Number.isInteger(id) && id > 0);
    
    if (validIds.length !== question_ids.length) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'All question_ids must be valid positive integers'
      });
    }
    
    // Optimized: Find only pending questions in one query (uses index on status)
    // Note: Ensure index exists: CREATE INDEX idx_questions_status_id ON questions(status, id);
    const pendingQuestions = await Question.findAll({
      where: {
        id: validIds,
        status: 'pending' // Filter at database level for better performance
      },
      attributes: ['id', 'status'], // Only select needed fields
      transaction,
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow bulk query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    });
    
    const foundPendingIds = new Set(pendingQuestions.map(q => q.id));
    const skippedIds = validIds.filter(id => !foundPendingIds.has(id));
    
    if (pendingQuestions.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'No pending questions found to approve',
        skipped_ids: skippedIds
      });
    }
    
    const pendingIds = pendingQuestions.map(q => q.id);
    
    // Optimized: Batch update using bulkUpdate (single query instead of N queries)
    // Note: Sequelize bulkUpdate is more efficient than individual updates
    const [updatedCount] = await Question.update(
      {
        status: 'approved',
        is_active: true
      },
      {
        where: {
          id: pendingIds
        },
        transaction
      }
    );
    
    // Optimized: Batch insert approval records (single query instead of N queries)
    const approvalRecords = pendingIds.map(questionId => ({
      question_id: questionId,
      approved_by: adminUser.id,
      approval_status: ApprovalStatus.APPROVED,
      admin_comment: admin_comment || 'Bulk approved by admin',
      approved_at: new Date()
    }));
    
    await QuestionApproval.bulkCreate(approvalRecords, { transaction });
    
    // Commit transaction
    await transaction.commit();
    
    logSlowQuery('bulk_approve', startTime);
    
    return res.json({
      approved_count: updatedCount,
      skipped_ids: skippedIds,
      message: `Bulk approval completed: ${updatedCount} question(s) approved`
    });
  } catch (error) {
    await transaction.rollback();
    logSlowQuery('bulk_approve_error', startTime);
    console.error(`❌ Error in bulk_approve: ${error.message}`);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({
      detail: 'Failed to bulk approve questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /admin/questions/:id/approvals - Get approval history for a question (optimized)
router.get('/:id/approvals', getCurrentUser, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  try {
    const questionId = parseInt(req.params.id, 10);
    
    if (isNaN(questionId) || questionId <= 0) {
      return res.status(400).json({
        detail: 'Invalid question ID'
      });
    }
    
    // Optimized query with explicit attributes and proper indexing
    // Note: Ensure composite index exists: CREATE INDEX idx_approvals_question_approved ON question_approvals(question_id, approved_at DESC);
    const approvals = await QuestionApproval.findAll({
      where: { question_id: questionId },
      attributes: ['id', 'approval_status', 'admin_comment', 'approved_at', 'approved_by'],
      include: [
        {
          model: require('../models').User,
          as: 'approver',
          attributes: ['id', 'full_name', 'email'],
          required: false // LEFT JOIN to avoid filtering out approvals without approver
        }
      ],
      order: [['approved_at', 'DESC']], // Uses index on approved_at
      logging: (sql) => {
        const queryTime = Date.now() - startTime;
        if (queryTime > 200) {
          console.warn(`⚠️  Slow approvals query: ${queryTime}ms - ${sql.substring(0, 200)}`);
        }
      }
    });
    
    logSlowQuery('get_approvals', startTime);
    
    return res.json(approvals.map(approval => ({
      id: approval.id,
      approval_status: approval.approval_status,
      admin_comment: approval.admin_comment,
      approver: approval.approver ? {
        id: approval.approver.id,
        full_name: approval.approver.full_name,
        email: approval.approver.email
      } : null,
      approved_at: (() => {
        const val = approval.getDataValue ? approval.getDataValue('approved_at') : (approval.dataValues?.approved_at || approval.approved_at);
        return val ? new Date(val).toISOString() : null;
      })()
    })));
  } catch (error) {
    logSlowQuery('get_approvals_error', startTime);
    console.error(`❌ Error in get_question_approvals: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get question approvals',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/*
 * ============================================
 * PERFORMANCE OPTIMIZATION NOTES
 * ============================================
 * 
 * RECOMMENDED DATABASE INDEXES:
 * 
 * 1. Composite index for pending filter (high priority):
 *    CREATE INDEX idx_questions_status_active ON questions(status, is_active);
 * 
 * 2. Composite index for cursor pagination (high priority):
 *    CREATE INDEX idx_questions_created_id ON questions(created_at DESC, id DESC);
 * 
 * 3. Index for section filtering:
 *    CREATE INDEX idx_questions_section_id ON questions(section_id);
 * 
 * 4. Composite index for status + id (bulk approve optimization):
 *    CREATE INDEX idx_questions_status_id ON questions(status, id);
 * 
 * 5. Full-text index for search (if full-text search is needed):
 *    ALTER TABLE questions ADD FULLTEXT INDEX idx_questions_text (question_text);
 * 
 * 6. Composite index for approvals query:
 *    CREATE INDEX idx_approvals_question_approved ON question_approvals(question_id, approved_at DESC);
 * 
 * 7. Index for question_type filtering (if frequently used):
 *    CREATE INDEX idx_questions_type ON questions(question_type);
 * 
 * PERFORMANCE MONITORING:
 * - All queries log warnings if they take > 200ms
 * - Check logs for "Slow query detected" warnings
 * - Monitor query execution times in production
 * 
 * QUERY OPTIMIZATION STRATEGIES:
 * - Use cursor-based pagination instead of OFFSET for large datasets
 * - Batch operations (bulkCreate, bulkUpdate) instead of individual queries
 * - Explicit attribute selection to avoid selecting unnecessary columns
 * - Proper use of indexes on WHERE and ORDER BY clauses
 * - LEFT JOINs (required: false) to avoid filtering out records unnecessarily
 */

module.exports = router;
