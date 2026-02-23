const express = require('express');
const router = express.Router();

// Career pathways data
const careerPathwaysData = [
  {
    aspiringField: 'Engineering',
    careerPaths: ['Civil Engineer', 'Mechanical Engineer', 'Robotics Engineer']
  },
  {
    aspiringField: 'Tech',
    careerPaths: ['Software Developer', 'Cybersecurity Analyst', 'Cloud Architect']
  },
  {
    aspiringField: 'Medical & Health',
    careerPaths: ['Medical Doctor', 'Registered Nurse', 'Healthcare Administrator']
  },
  {
    aspiringField: 'Data Science',
    careerPaths: ['Machine Learning Engineer', 'Data Scientist', 'AI Research Scientist']
  },
  {
    aspiringField: 'Data Analytics',
    careerPaths: ['Business Intelligence Analyst', 'Operations Analyst', 'Market Research Analyst']
  },
  {
    aspiringField: 'Pure & Applied Science',
    careerPaths: ['Research Scientist', 'Biotechnologist', 'Environmental Consultant']
  },
  {
    aspiringField: 'Business & Management',
    careerPaths: ['Project Manager', 'Operations Manager', 'Management Consultant']
  },
  {
    aspiringField: 'Accounting',
    careerPaths: ['Certified Public Accountant', 'Forensic Accountant', 'Tax Auditor']
  },
  {
    aspiringField: 'Finance',
    careerPaths: ['Investment Banker', 'Financial Planner', 'Portfolio Manager']
  },
  {
    aspiringField: 'Humanities',
    careerPaths: ['Psychologist', 'Technical Writer', 'Policy Analyst']
  },
  {
    aspiringField: 'Design',
    careerPaths: ['UX/UI Designer', 'Graphic Designer', 'Industrial Designer']
  },
  {
    aspiringField: 'Media',
    careerPaths: ['Content Producer', 'Public Relations Specialist', 'Digital Editor']
  },
  {
    aspiringField: 'Networking',
    careerPaths: ['Network Engineer', 'Systems Administrator', 'Solutions Architect']
  },
  {
    aspiringField: 'Marketing',
    careerPaths: ['Digital Marketing Manager', 'Brand Strategist', 'Social Media Director']
  },
  {
    aspiringField: 'Law',
    careerPaths: ['Corporate Attorney', 'Legal Consultant', 'Paralegal']
  },
  {
    aspiringField: 'Computer Applications',
    careerPaths: ['Web Developer', 'Database Administrator', 'Mobile App Developer']
  },
  {
    aspiringField: 'Hospitality',
    careerPaths: ['Hotel Manager', 'Event Coordinator', 'Tourism Director']
  }
];

// GET /career-pathways - Get all aspiring fields and career paths
router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      data: careerPathwaysData,
      count: careerPathwaysData.length
    });
  } catch (error) {
    console.error('❌ Error fetching career pathways data:', error);
    res.status(500).json({
      detail: 'Failed to fetch career pathways data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;

