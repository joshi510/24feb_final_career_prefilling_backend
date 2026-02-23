const axios = require('axios');
const config = require('../config');
const { InterpretedResult } = require('../models/InterpretedResult');

/**
 * Generate RIASEC career assessment report using Gemini API
 * @param {Object} scores - RIASEC scores
 * @param {number} scores.R - Realistic score
 * @param {number} scores.I - Investigative score
 * @param {number} scores.A - Artistic score
 * @param {number} scores.S - Social score
 * @param {number} scores.E - Enterprising score
 * @param {number} scores.C - Conventional score
 * @param {number} [scores.testAttemptId] - Optional test attempt ID for caching
 * @returns {Promise<{report: Object, error: string|null}>}
 */
async function generateRIASECReport({ R, I, A, S, E, C, testAttemptId }) {
  const apiKey = config.gemini.apiKey;
  
  if (!apiKey || !apiKey.trim()) {
    return { report: null, error: 'GEMINI_API_KEY environment variable is not set' };
  }

  // Validate scores
  if (R === undefined || I === undefined || A === undefined || 
      S === undefined || E === undefined || C === undefined) {
    return { report: null, error: 'All RIASEC scores (R, I, A, S, E, C) are required' };
  }

  // Calculate match levels - Deterministic classification
  const getMatchLevel = (score) => {
    if (score >= 30) return 'HIGH MATCH';
    if (score >= 15) return 'MODERATE MATCH';
    return 'LOW MATCH';
  };

  // Deterministic career pathway calculation
  const calculateCareerPathways = (top3Codes, scores) => {
    const primaryRiasecMix = `${top3Codes[0]}-${top3Codes[1]}-${top3Codes[2]}`;
    
    const calculateConfidence = (riasecMix, top3Codes, top3Scores, allScores) => {
      const pathwayCodes = riasecMix.split('-');
      if (pathwayCodes.length < 2) {
        return { level: 'LOW', label: 'Low Confidence' };
      }
      
      const primaryCode = pathwayCodes[0];
      const secondaryCode = pathwayCodes[1];
      const tertiaryCode = pathwayCodes[2];
      
      const primaryScore = allScores[primaryCode] || 0;
      const secondaryScore = allScores[secondaryCode] || 0;
      const tertiaryScore = tertiaryCode ? (allScores[tertiaryCode] || 0) : 0;
      
      const topScore = top3Scores[0] || 0;
      const secondScore = top3Scores[1] || 0;
      const thirdScore = top3Scores[2] || 0;
      
      const primaryRank = top3Codes.indexOf(primaryCode);
      const secondaryRank = top3Codes.indexOf(secondaryCode);
      const tertiaryRank = tertiaryCode ? top3Codes.indexOf(tertiaryCode) : -1;
      
      const primaryGap = primaryRank === 0 ? 0 : (topScore - primaryScore);
      const secondaryGap = secondaryRank >= 0 ? Math.abs((secondaryRank === 0 ? topScore : (secondaryRank === 1 ? secondScore : thirdScore)) - secondaryScore) : (topScore - secondaryScore);
      
      const matchesInTop3 = [primaryRank, secondaryRank, tertiaryRank].filter(r => r >= 0).length;
      const avgScore = (primaryScore + secondaryScore + (tertiaryScore || 0)) / (tertiaryCode ? 3 : 2);
      const avgTopScore = (topScore + secondScore + thirdScore) / 3;
      
      const scoreFit = avgScore / Math.max(avgTopScore, 1);
      const gapPenalty = (primaryGap + secondaryGap) / Math.max(topScore, 1);
      
      if (primaryRank === 0 && secondaryRank === 1 && matchesInTop3 >= 2 && primaryScore >= 30 && scoreFit >= 0.85 && gapPenalty <= 0.15) {
        return { level: 'HIGH', label: 'High Confidence' };
      } else if (primaryRank === 0 && matchesInTop3 >= 2 && primaryScore >= 25 && scoreFit >= 0.70 && gapPenalty <= 0.25) {
        return { level: 'MODERATE', label: 'Moderate Confidence' };
      } else if (primaryRank >= 0 && primaryRank <= 2 && matchesInTop3 >= 1 && primaryScore >= 20 && scoreFit >= 0.60) {
        return { level: 'MODERATE', label: 'Moderate Confidence' };
      } else {
        return { level: 'LOW', label: 'Low Confidence' };
      }
    };
    const allDegrees = ['BCA', 'MCA', 'M.Sc (IT)', 'M.Sc (Computer Science)', 'B.Tech (CS)', 'B.Tech (IT)', 'B.E. (Computer Engineering)', 'B.Sc (IT)', 'B.Sc (Computer Science)', 'B.Voc (SD)'];
    const allRoles = ['Full Stack Developer', 'Frontend Developer', 'Backend Developer', 'Mobile App Developer', 'Data Analyst', 'Data Scientist', 'Data Engineer', 'DevOps Engineer', 'Cloud Engineer', 'Web Designer', 'UI/UX Designer', 'Product Designer', 'Software Tester', 'Cybersecurity Analyst', 'AI / ML Engineer', 'Game Developer'];

    const calculateDegree = (primary, secondary) => {
      if (primary === 'I' && secondary === 'A') return allDegrees[4];
      if (primary === 'A' && secondary === 'I') return allDegrees[0];
      if (primary === 'I' && secondary === 'C') return allDegrees[2];
      if (primary === 'C' && secondary === 'I') return allDegrees[5];
      if (primary === 'A' && secondary === 'C') return allDegrees[0];
      if (primary === 'C' && secondary === 'A') return allDegrees[9];
      if (primary === 'R' && secondary === 'I') return allDegrees[6];
      if (primary === 'I' && secondary === 'R') return allDegrees[4];
      if (primary === 'R' && secondary === 'A') return allDegrees[6];
      if (primary === 'A' && secondary === 'R') return allDegrees[0];
      if (primary === 'R' && secondary === 'C') return allDegrees[6];
      if (primary === 'C' && secondary === 'R') return allDegrees[5];
      if (primary === 'S' && secondary === 'I') return allDegrees[8];
      if (primary === 'I' && secondary === 'S') return allDegrees[1];
      if (primary === 'S' && secondary === 'A') return allDegrees[7];
      if (primary === 'A' && secondary === 'S') return allDegrees[0];
      if (primary === 'S' && secondary === 'C') return allDegrees[7];
      if (primary === 'C' && secondary === 'S') return allDegrees[5];
      if (primary === 'E' && secondary === 'I') return allDegrees[4];
      if (primary === 'E' && secondary === 'A') return allDegrees[0];
      if (primary === 'E' && secondary === 'C') return allDegrees[5];
      if (primary === 'E' && secondary === 'S') return allDegrees[7];
      if (primary === 'E' && secondary === 'R') return allDegrees[6];
      if (primary === 'I' && secondary === 'E') return allDegrees[4];
      if (primary === 'A' && secondary === 'E') return allDegrees[0];
      if (primary === 'C' && secondary === 'E') return allDegrees[5];
      if (primary === 'S' && secondary === 'E') return allDegrees[7];
      if (primary === 'R' && secondary === 'E') return allDegrees[6];
      return allDegrees[4];
    };

    const calculateRole = (primary, secondary) => {
      if (primary === 'I' && secondary === 'A') return 'Data Scientist';
      if (primary === 'I' && secondary === 'C') return 'Data Engineer';
      if (primary === 'A' && secondary === 'I') return 'UI/UX Designer';
      if (primary === 'A' && secondary === 'C') return 'Web Designer';
      if (primary === 'C' && secondary === 'I') return 'Data Analyst';
      if (primary === 'C' && secondary === 'A') return 'Software Tester';
      if (primary === 'I' && secondary === 'R') return 'AI / ML Engineer';
      if (primary === 'R' && secondary === 'I') return 'DevOps Engineer';
      if (primary === 'A' && secondary === 'S') return 'Product Designer';
      if (primary === 'S' && secondary === 'A') return 'Frontend Developer';
      if (primary === 'I' && secondary === 'S') return 'Backend Developer';
      if (primary === 'S' && secondary === 'I') return 'Full Stack Developer';
      if (primary === 'R' && secondary === 'C') return 'Cybersecurity Analyst';
      if (primary === 'C' && secondary === 'R') return 'Backend Developer';
      if (primary === 'A' && secondary === 'R') return 'Game Developer';
      if (primary === 'R' && secondary === 'A') return 'Cybersecurity Analyst';
      if (primary === 'S' && secondary === 'C') return 'Mobile App Developer';
      if (primary === 'C' && secondary === 'S') return 'Frontend Developer';
      return 'Full Stack Developer';
    };

    const calculatePersona = (role) => {
      const personaMap = {
        'Data Scientist': 'The Insight Architect',
        'Data Engineer': 'The Analytical Strategist',
        'UI/UX Designer': 'The Creative Innovator',
        'Web Designer': 'The Design Visionary',
        'Data Analyst': 'The Precision Analyst',
        'Software Tester': 'The Quality Specialist',
        'AI / ML Engineer': 'The Intelligent Builder',
        'DevOps Engineer': 'The Technical Architect',
        'Product Designer': 'The User Experience Creator',
        'Frontend Developer': 'The Interface Designer',
        'Backend Developer': 'The System Architect',
        'Full Stack Developer': 'The Solution Integrator',
        'Mobile App Developer': 'The Mobile Innovator',
        'Cloud Engineer': 'The Infrastructure Specialist',
        'Cybersecurity Analyst': 'The Security Guardian',
        'Game Developer': 'The Interactive Creator'
      };
      return personaMap[role] || 'The Technical Professional';
    };

    const calculateFocus = (role) => {
      const focusMap = {
        'Data Scientist': 'Analyzing complex data patterns and creating innovative solutions through research and creative problem-solving.',
        'Data Engineer': 'Building robust data infrastructure and systems with analytical precision and structured methodologies.',
        'UI/UX Designer': 'Designing intuitive user experiences by combining creative vision with analytical insights.',
        'Web Designer': 'Creating visually compelling digital products through systematic design processes.',
        'Data Analyst': 'Ensuring data quality and system reliability through meticulous analysis and testing.',
        'Software Tester': 'Maintaining software quality standards through systematic testing and creative problem-solving approaches.',
        'AI / ML Engineer': 'Developing intelligent systems and algorithms that solve real-world technical challenges.',
        'DevOps Engineer': 'Architecting scalable infrastructure solutions with technical expertise and innovative approaches.',
        'Product Designer': 'Creating user-centered design solutions that balance creativity with technical feasibility.',
        'Frontend Developer': 'Building engaging user interfaces that combine aesthetic design with functional requirements.',
        'Backend Developer': 'Designing and implementing backend systems that integrate complex technical requirements.',
        'Full Stack Developer': 'Developing end-to-end solutions that seamlessly connect frontend and backend technologies.',
        'Mobile App Developer': 'Creating mobile applications that deliver seamless user experiences across platforms.',
        'Cloud Engineer': 'Designing and managing cloud infrastructure solutions for scalable and reliable systems.',
        'Cybersecurity Analyst': 'Protecting digital assets through systematic security analysis and threat mitigation.',
        'Game Developer': 'Creating interactive entertainment experiences through creative design and technical implementation.'
      };
      return focusMap[role] || 'Developing software solutions through systematic analysis and implementation.';
    };

    const roleData = [
      {
        role: calculateRole(top3Codes[0], top3Codes[1]),
        riasecMix: primaryRiasecMix
      },
      {
        role: calculateRole(top3Codes[0], top3Codes[2]),
        riasecMix: primaryRiasecMix
      },
      {
        role: calculateRole(top3Codes[1], top3Codes[2]),
        riasecMix: primaryRiasecMix
      }
    ].filter((item, index, self) => 
      index === self.findIndex(i => i.role === item.role)
    );

    const usedRoles = new Set(roleData.map(r => r.role));
    const additionalRoles = allRoles
      .filter(r => !usedRoles.has(r))
      .slice(0, 5 - roleData.length)
      .map(role => ({
        role,
        riasecMix: primaryRiasecMix
      }));

    const allRoleData = [...roleData, ...additionalRoles].slice(0, 5);

    const degreeCombinations = [
      [top3Codes[0], top3Codes[1]],
      [top3Codes[0], top3Codes[2]],
      [top3Codes[1], top3Codes[2]],
      [top3Codes[1], top3Codes[0]],
      [top3Codes[2], top3Codes[0]],
      [top3Codes[2], top3Codes[1]]
    ];

    const calculatedDegrees = degreeCombinations
      .map(([p, s]) => calculateDegree(p, s))
      .filter((v, i, a) => a.indexOf(v) === i);

    const additionalDegrees = allDegrees.filter(d => !calculatedDegrees.includes(d));
    const degrees = [...calculatedDegrees, ...additionalDegrees].slice(0, 10);

    while (degrees.length < 5 && allDegrees.length > 0) {
      const remaining = allDegrees.filter(d => d && !degrees.includes(d));
      if (remaining.length === 0) break;
      degrees.push(...remaining);
    }

    const usedDegrees = new Set();
    const top3Scores = sortedScores.slice(0, 3).map(item => item.score || 0).filter(s => !isNaN(s));
    const allScores = { R: R || 0, I: I || 0, A: A || 0, S: S || 0, E: E || 0, C: C || 0 };
    const allDegreesLength = allDegrees.length || 1;
    const degreesLength = degrees.length || 1;
    
    return allRoleData.map((roleItem, idx) => {
      const safeIdx = (typeof idx === 'number' && !isNaN(idx) && idx >= 0) ? idx : 0;
      let degree = degrees[safeIdx] || (allDegreesLength > 0 ? allDegrees[safeIdx % allDegreesLength] : allDegrees[0] || 'B.Tech (CS)');
      
      if (!degree || usedDegrees.has(degree)) {
        const availableDegrees = allDegrees.filter(d => d && !usedDegrees.has(d));
        const availableLength = availableDegrees.length || 1;
        if (availableLength > 0) {
          degree = availableDegrees[safeIdx % availableLength] || availableDegrees[0];
        } else {
          degree = allDegreesLength > 0 ? allDegrees[safeIdx % allDegreesLength] : allDegrees[0] || 'B.Tech (CS)';
        }
      }
      
      if (!degree) {
        degree = 'B.Tech (CS)';
      }
      
      usedDegrees.add(degree);
      const confidence = calculateConfidence(roleItem.riasecMix, top3Codes, top3Scores, allScores);
      return {
        degree,
        riasecMix: roleItem.riasecMix || '',
        careerRole: roleItem.role || 'Full Stack Developer',
        professionalPersona: calculatePersona(roleItem.role) || 'The Technical Professional',
        coreTasksFocus: calculateFocus(roleItem.role) || 'Developing software solutions through systematic analysis and implementation.',
        confidence: confidence?.label || 'Moderate Confidence',
        confidenceLevel: confidence?.level || 'MODERATE'
      };
    });
  };

  // Determine top traits (top 3 scores) with labels
  const scoreMap = [
    { code: 'R', score: R, label: 'Realistic', title: 'Realistic (Doers)' },
    { code: 'I', score: I, label: 'Investigative', title: 'Investigative (Thinkers)' },
    { code: 'A', score: A, label: 'Artistic', title: 'Artistic (Creators)' },
    { code: 'S', score: S, label: 'Social', title: 'Social (Helpers)' },
    { code: 'E', score: E, label: 'Enterprising', title: 'Enterprising (Persuaders)' },
    { code: 'C', score: C, label: 'Conventional', title: 'Conventional (Organizers)' }
  ];
  
  const sortedScores = scoreMap.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.code.localeCompare(b.code);
  });
  const topTraits = sortedScores.slice(0, 3).map(item => ({
    code: item.code,
    label: item.label,
    score: Math.round(item.score)
  }));

  // Calculate decision risk based on top 3 scores
  const top3Scores = sortedScores.slice(0, 3).map(s => s.score);
  const topScore = top3Scores[0];
  const secondScore = top3Scores[1];
  const thirdScore = top3Scores[2];
  const diffTopSecond = topScore - secondScore;
  const diffSecondThird = secondScore - thirdScore;
  
  let decisionRiskLevel = 'Moderate Risk';
  let stability = 'Moderately Stable';
  
  if (diffTopSecond < 10 && diffSecondThird < 10) {
    // Top 3 scores are very close
    decisionRiskLevel = 'Moderate Risk';
    stability = 'Developing';
  } else if (diffTopSecond >= 15 && diffSecondThird >= 10) {
    // One clearly dominant trait
    decisionRiskLevel = 'Low Risk';
    stability = 'Highly Stable';
  } else if (topScore < 50 || (topScore - sortedScores[5].score) < 20) {
    // Inconsistent or low profile
    decisionRiskLevel = 'High Risk';
    stability = 'Developing';
  } else {
    decisionRiskLevel = 'Moderate Risk';
    stability = 'Moderately Stable';
  }

  const prompt = `You are a certified Holland Code (RIASEC) psychometric assessment engine.

Generate a structured RIASEC career profile report.

IMPORTANT:
- Do NOT generate career readiness stage analysis.
- Do NOT include exploration phase language.
- Do NOT include action roadmap.
- Do NOT include motivational advice.
- Focus ONLY on RIASEC personality dimensions.
- Output must be valid JSON only.
- No extra text outside JSON.

INPUT SCORES:
R: ${R}
I: ${I}
A: ${A}
S: ${S}
E: ${E}
C: ${C}

MATCH LEVEL RULE (STRICT):
- >= 30 → "HIGH MATCH"
- 15-29 → "MODERATE MATCH"
- < 15 → "LOW MATCH"

OUTPUT FORMAT:

{
  "riasecProfile": {
    "decisionRisk": {
      "level": "${decisionRiskLevel}",
      "stability": "${stability}",
      "insight": "1 concise professional sentence"
    },
    "topQualities": ["short phrase", "short phrase", "short phrase"],
    "topTraits": [
      { "code": "${topTraits[0].code}", "label": "${topTraits[0].label}", "score": ${topTraits[0].score} },
      { "code": "${topTraits[1].code}", "label": "${topTraits[1].label}", "score": ${topTraits[1].score} },
      { "code": "${topTraits[2].code}", "label": "${topTraits[2].label}", "score": ${topTraits[2].score} }
    ]
  },
  "dimensions": [
    {
      "code": "R",
      "title": "Realistic (Doers)",
      "score": ${Math.round(R)},
      "matchLevel": "${getMatchLevel(R)}",
      "tagline": "Practical, hands-on, and action-oriented tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    },
    {
      "code": "I",
      "title": "Investigative (Thinkers)",
      "score": ${Math.round(I)},
      "matchLevel": "${getMatchLevel(I)}",
      "tagline": "Analytical, research-oriented, and problem-solving tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    },
    {
      "code": "A",
      "title": "Artistic (Creators)",
      "score": ${Math.round(A)},
      "matchLevel": "${getMatchLevel(A)}",
      "tagline": "Creative, expressive, and innovative tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    },
    {
      "code": "S",
      "title": "Social (Helpers)",
      "score": ${Math.round(S)},
      "matchLevel": "${getMatchLevel(S)}",
      "tagline": "People-oriented, supportive, and service-focused tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    },
    {
      "code": "E",
      "title": "Enterprising (Persuaders)",
      "score": ${Math.round(E)},
      "matchLevel": "${getMatchLevel(E)}",
      "tagline": "Leadership, influence, and business-oriented tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    },
    {
      "code": "C",
      "title": "Conventional (Organizers)",
      "score": ${Math.round(C)},
      "matchLevel": "${getMatchLevel(C)}",
      "tagline": "Structured, organized, and detail-oriented tasks.",
      "personalizedAnalysis": "2 concise behavioral sentences aligned with score strength.",
      "coreStrengths": [
        "short bullet",
        "short bullet",
        "short bullet"
      ],
      "growthAreas": [
        "short bullet",
        "short bullet"
      ],
      "workStylePreferences": "1 concise sentence."
    }
  ],
}

RULES:
- Each dimension must reflect score intensity.
- No repeated content across dimensions.
- Keep all descriptions short and professional.
- Maintain psychometric tone.
- Return JSON only.
- Do NOT include career pathways in your response.
- Do NOT include readiness, exploration, or action plan language.
- Use bullet points format for all lists (coreStrengths, growthAreas).
- Convert long paragraphs to concise bullet points.
- For low overall scores (<40), use cautious language: "Emerging tendencies", "Developing preferences", "Early indicators".
- Avoid overly strong positive traits when scores are low.
- Do NOT use phrases like "lack of highly dominant interests", "broad but not deeply specialized", "may require further refinement", or similar language suggesting profile inadequacy.
- Focus on positive interpretation of the profile pattern without suggesting it needs improvement or refinement.

Return the JSON now:`;

  // Retry configuration for rate limit errors
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const modelName = 'gemini-2.5-flash';
      const apiVersion = 'v1';
      const apiUrl = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
      
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff: 2s, 4s, 8s
        console.log(`⏳ Retrying RIASEC report generation (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.log(`🤖 Generating RIASEC report with Gemini API: ${modelName}`);
      }
      
      const response = await axios.post(
        apiUrl,
        {
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 seconds
        }
      );

      // Validate response structure
      if (!response.data || !response.data.candidates || !Array.isArray(response.data.candidates) || response.data.candidates.length === 0) {
        console.error('❌ Invalid Gemini API response structure:', JSON.stringify(response.data, null, 2));
        return { report: null, error: 'Invalid response from AI service. Please try again.' };
      }

      const candidate = response.data.candidates[0];
      if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
        console.error('❌ Invalid Gemini API response content:', JSON.stringify(candidate, null, 2));
        return { report: null, error: 'AI service returned empty content. Please try again.' };
      }

      // Check for safety ratings
      if (candidate.safetyRatings && candidate.safetyRatings.some(rating => rating.blocked)) {
        console.error('❌ Content blocked by safety filters:', JSON.stringify(candidate.safetyRatings, null, 2));
        return { report: null, error: 'Content was blocked by safety filters. Please try again.' };
      }

      let responseText = candidate.content.parts[0].text;
      if (!responseText || typeof responseText !== 'string') {
        console.error('❌ Invalid response text:', responseText);
        return { report: null, error: 'AI service returned invalid response. Please try again.' };
      }

      responseText = responseText.trim();

      // Remove markdown code blocks if present
      if (responseText.startsWith('```json')) {
        responseText = responseText.substring(7);
      }
      if (responseText.startsWith('```')) {
        responseText = responseText.substring(3);
      }
      if (responseText.endsWith('```')) {
        responseText = responseText.substring(0, responseText.length - 3);
      }
      responseText = responseText.trim();

      if (!responseText || responseText.length === 0) {
        console.error('❌ Empty response text after processing');
        return { report: null, error: 'AI service returned empty response. Please try again.' };
      }

      let report;
      try {
        report = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ JSON parse error:', parseError.message);
        console.error('❌ Response text (first 500 chars):', responseText.substring(0, 500));
        return { report: null, error: 'Failed to parse AI response. Please try again.' };
      }

      // Validate structure
      if (!report.riasecProfile || !report.dimensions || !Array.isArray(report.dimensions)) {
        return { report: null, error: 'Invalid report structure from AI service' };
      }

      // Post-process to remove unwanted phrases
      const unwantedPhrases = [
        'lack of highly dominant interests',
        'broad but not deeply specialized',
        'may require further refinement',
        'requires further refinement',
        'needs further refinement'
      ];
      
      // Clean decisionRisk insight
      if (report.riasecProfile?.decisionRisk?.insight) {
        let insight = report.riasecProfile.decisionRisk.insight;
        unwantedPhrases.forEach(phrase => {
          const regex = new RegExp(phrase, 'gi');
          insight = insight.replace(regex, '');
        });
        // Clean up extra spaces and punctuation
        insight = insight.replace(/\s+/g, ' ').replace(/[.,]\s*[.,]/g, '.').trim();
        report.riasecProfile.decisionRisk.insight = insight;
      }
      
      // Clean dimension personalizedAnalysis
      if (report.dimensions && Array.isArray(report.dimensions)) {
        report.dimensions.forEach(dimension => {
          if (dimension.personalizedAnalysis) {
            let analysis = dimension.personalizedAnalysis;
            unwantedPhrases.forEach(phrase => {
              const regex = new RegExp(phrase, 'gi');
              analysis = analysis.replace(regex, '');
            });
            // Clean up extra spaces and punctuation
            analysis = analysis.replace(/\s+/g, ' ').replace(/[.,]\s*[.,]/g, '.').trim();
            dimension.personalizedAnalysis = analysis;
          }
        });
      }

      // Ensure all 6 dimensions are present
      const requiredCodes = ['R', 'I', 'A', 'S', 'E', 'C'];
      const presentCodes = report.dimensions.map(d => d.code);
      const missingCodes = requiredCodes.filter(code => !presentCodes.includes(code));
      
      if (missingCodes.length > 0) {
        console.warn(`⚠️ Missing dimensions in report: ${missingCodes.join(', ')}`);
      }

      // Calculate career pathways deterministically
      const top3Codes = sortedScores.slice(0, 3).map(item => item.code);
      report.careerPathways = calculateCareerPathways(top3Codes, { R, I, A, S, E, C });

      // Store report in database if testAttemptId is provided
      if (testAttemptId) {
        try {
          const interpretedResult = await InterpretedResult.findOne({
            where: { test_attempt_id: testAttemptId }
          });
          
          if (interpretedResult) {
            await InterpretedResult.update({
              riasec_report: {
                scores: { R, I, A, S, E, C },
                report: report
              }
            }, {
              where: { id: interpretedResult.id }
            });
            console.log(`✅ RIASEC report cached in database for attempt ${testAttemptId}`);
          } else {
            console.warn(`⚠️ No interpreted result found for attempt ${testAttemptId}, cannot cache RIASEC report`);
          }
        } catch (dbError) {
          console.warn(`⚠️ Failed to cache RIASEC report: ${dbError.message}`);
          // Don't fail the request if caching fails
        }
      }
      
      return { report, error: null };
    } catch (error) {
      lastError = error;
      console.error(`❌ Error in generateRIASECReport (attempt ${attempt + 1}/${maxRetries + 1}):`, error.message);
      
      // Handle axios errors
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        console.error(`❌ Gemini API error (${status}):`, JSON.stringify(data, null, 2));
        
        // Retry on rate limit (429) or server errors (5xx)
        if (status === 429 && attempt < maxRetries) {
          console.log(`⚠️ Rate limit hit. Will retry after backoff...`);
          continue; // Retry with exponential backoff
        } else if (status >= 500 && status < 600 && attempt < maxRetries) {
          console.log(`⚠️ Server error. Will retry after backoff...`);
          continue; // Retry on server errors
        }
        
        // Don't retry on other errors
        const errorMessage = data?.error?.message || '';
        if (status === 401 || status === 403) {
          return { report: null, error: 'Gemini API authentication failed. Please check your API key.' };
        } else if (status === 429) {
          return { report: null, error: 'Gemini API rate limit exceeded. Please try again in a few minutes.' };
        } else if (status >= 500) {
          return { report: null, error: 'Gemini API server error. Please try again later.' };
        } else {
          return { report: null, error: errorMessage || `API error (${status}). Please try again.` };
        }
      } else if (error.request) {
        // Network error - retry if not last attempt
        if (attempt < maxRetries) {
          console.log(`⚠️ Network error. Will retry after backoff...`);
          continue;
        }
        console.error('❌ No response from Gemini API (timeout or network error)');
        return { report: null, error: 'Network error: Could not reach AI service. Please check your connection and try again.' };
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        // Timeout - retry if not last attempt
        if (attempt < maxRetries) {
          console.log(`⚠️ Timeout. Will retry after backoff...`);
          continue;
        }
        return { report: null, error: 'Request timeout: AI service took too long to respond. Please try again.' };
      } else {
        // Other errors - don't retry
        if (error.message.toLowerCase().includes('api key') || error.message.toLowerCase().includes('authentication')) {
          return { report: null, error: 'Gemini API authentication failed. Please check your API key.' };
        } else if (error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('rate limit')) {
          return { report: null, error: 'Gemini API rate limit exceeded. Please try again in a few minutes.' };
        } else {
          return { report: null, error: `RIASEC report generation failed: ${error.message}. Please try again.` };
        }
      }
    }
  }
  
  // If we get here, all retries failed
  console.error('❌ All retry attempts failed. Last error:', lastError?.message);
  return { report: null, error: 'Gemini API rate limit exceeded. Please try again in a few minutes.' };
}

module.exports = {
  generateRIASECReport
};

