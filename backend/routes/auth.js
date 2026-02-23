const express = require('express');
const router = express.Router();
const { User, UserRole, Student } = require('../models');
const { createAccessToken } = require('../middleware/auth');
const { getPasswordHash, verifyPassword } = require('../middleware/password');

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      first_name, 
      last_name, 
      contact_number, 
      parent_contact_number, 
      school_institute_name, 
      current_education, 
      stream, 
      family_annual_income 
    } = req.body;

    console.log(`\n${'='.repeat(50)}`);
    console.log('🔵 REGISTRATION REQUEST RECEIVED');
    console.log(`   Email: ${email}`);
    console.log(`   First Name: ${first_name}`);
    console.log(`   Last Name: ${last_name}`);
    console.log(`   Contact Number: ${contact_number}`);
    console.log(`   Parent Contact Number: ${parent_contact_number}`);
    console.log(`   School/Institute: ${school_institute_name}`);
    console.log(`   Current Education: ${current_education}`);
    console.log(`   Stream: ${stream}`);
    console.log(`   Family Annual Income: ${family_annual_income}`);
    console.log(`${'='.repeat(50)}\n`);

    // Validate required fields
    if (!first_name || !last_name || !contact_number || !parent_contact_number || 
        !school_institute_name || !current_education || !stream || !family_annual_income) {
      return res.status(400).json({
        detail: 'All fields are required'
      });
    }

    // Validate contact numbers are exactly 10 digits
    const contactDigits = contact_number ? contact_number.replace(/\D/g, '') : '';
    const parentContactDigits = parent_contact_number ? parent_contact_number.replace(/\D/g, '') : '';
    
    if (contactDigits.length !== 10) {
      return res.status(400).json({
        detail: 'Contact Number must be exactly 10 digits'
      });
    }

    if (parentContactDigits.length !== 10) {
      return res.status(400).json({
        detail: "Parent's Contact Number must be exactly 10 digits"
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        detail: 'Email already registered'
      });
    }

    // Check if contact number already exists
    const existingContact = await Student.findOne({ where: { contact_number: contactDigits } });
    if (existingContact) {
        return res.status(400).json({
        detail: 'Contact number already registered'
        });
    }

    // Create full name from first and last name
    const full_name = `${first_name} ${last_name}`.trim();

    // Create new student user - registration is always for STUDENT role
    const hashedPassword = await getPasswordHash(password);
    
    // Use transaction to ensure atomicity
    const transaction = await User.sequelize.transaction();
    
    try {
      const newUser = await User.create({
        email,
        password_hash: hashedPassword,
        full_name,
        role: UserRole.STUDENT
      }, { transaction });

      console.log(`🔵 User created with ID: ${newUser.id}, role: ${newUser.role}`);

      // Create student profile - ATOMIC with user creation
      const studentProfile = await Student.create({
        user_id: newUser.id,
        first_name,
        last_name,
        contact_number: contactDigits,
        parent_contact_number: parentContactDigits,
        school_institute_name,
        current_education,
        stream,
        family_annual_income
      }, { transaction });

      console.log(`✅ Student profile created for user ID: ${newUser.id}`);
      
      await transaction.commit();
      console.log(`✅ Transaction committed - User ID: ${newUser.id}, Student profile ID: ${studentProfile.id}`);

      // Create access token
      const accessToken = createAccessToken({
        sub: String(newUser.id),
        role: newUser.role
      });

      return res.status(201).json({
        access_token: accessToken,
        token_type: 'bearer',
        user: {
          id: newUser.id,
          email: newUser.email,
          full_name: newUser.full_name,
          role: newUser.role
        }
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error(`❌ Registration failed: ${error.name}: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      detail: `Registration failed: ${error.message}`
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    // Support both form-data and JSON
    const username = req.body.username || req.body.email;
    const password = req.body.password;

    if (!username || !password) {
      return res.status(400).json({
        detail: 'Email and password are required'
      });
    }

    const user = await User.findOne({ where: { email: username } });

    if (!user) {
      console.log(`❌ Login failed: User not found for email: ${username}`);
      return res.status(401).json({
        detail: 'Incorrect email or password'
      });
    }

    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      console.log(`❌ Login failed: Invalid password for user: ${user.email}`);
      return res.status(401).json({
        detail: 'Incorrect email or password'
      });
    }

    console.log(`✅ Login successful: ${user.email} (role: ${user.role})`);

    const accessToken = createAccessToken({
      sub: String(user.id),
      role: user.role
    });

    return res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        center: user.center || null,
        is_first_login: user.is_first_login || false
      }
    });
  } catch (error) {
    console.error(`❌ Login error: ${error.message}`);
    return res.status(500).json({
      detail: 'Login failed'
    });
  }
});

// Get current user info
router.get('/me', require('../middleware/auth').getCurrentUser, async (req, res) => {
  return res.json({
    id: req.user.id,
    email: req.user.email,
    full_name: req.user.full_name,
    role: req.user.role
  });
});

// Create user (Admin only)
router.post('/create-user', require('../middleware/auth').getCurrentUser, require('../middleware/auth').requireAdmin, async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (role === UserRole.STUDENT) {
      return res.status(400).json({
        detail: 'Use /register endpoint for student registration'
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        detail: 'Email already registered'
      });
    }

    // Create new user
    const hashedPassword = await getPasswordHash(password);
    const newUser = await User.create({
      email,
      password_hash: hashedPassword,
      full_name,
      role
    });

    return res.status(201).json({
      id: newUser.id,
      email: newUser.email,
      full_name: newUser.full_name,
      role: newUser.role
    });
  } catch (error) {
    console.error(`❌ Create user error: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to create user'
    });
  }
});

module.exports = router;

