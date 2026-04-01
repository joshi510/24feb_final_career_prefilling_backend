const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const { Appointment, AppointmentStatus, User, Student } = require('../models');
const { getCurrentUser, requireAdmin } = require('../middleware/auth');

// Create appointment (Student only)
router.post('/', getCurrentUser, async (req, res) => {
  try {
    const { appointment_date, appointment_time, notes } = req.body;
    const studentId = req.user.id;

    // Validate required fields
    if (!appointment_date || !appointment_time) {
      return res.status(400).json({
        detail: 'Appointment date and time are required'
      });
    }

    // Validate date is not in the past
    const appointmentDateTime = new Date(`${appointment_date}T${appointment_time}`);
    if (appointmentDateTime < new Date()) {
      return res.status(400).json({
        detail: 'Appointment date and time must be in the future'
      });
    }

    // Create appointment
    const appointment = await Appointment.create({
      student_id: studentId,
      appointment_date: appointment_date,
      appointment_time: appointment_time,
      status: AppointmentStatus.PENDING,
      notes: notes || null
    });

    // Fetch appointment with student details
    const appointmentWithDetails = await Appointment.findOne({
      where: { id: appointment.id },
      include: [
        {
          model: User,
          as: 'student',
          attributes: ['id', 'full_name', 'email'],
          include: [
            {
              model: Student,
              as: 'studentProfile',
              attributes: ['school_institute_name', 'contact_number', 'first_name', 'last_name']
            }
          ]
        }
      ]
    });

    // Format the response to ensure consistent date/time format
    const formattedAppointment = appointmentWithDetails.toJSON();
    if (formattedAppointment.appointment_date) {
      if (formattedAppointment.appointment_date instanceof Date) {
        formattedAppointment.appointment_date = formattedAppointment.appointment_date.toISOString().split('T')[0];
      } else if (typeof formattedAppointment.appointment_date === 'string' && formattedAppointment.appointment_date.includes('T')) {
        formattedAppointment.appointment_date = formattedAppointment.appointment_date.split('T')[0];
      }
    }
    if (formattedAppointment.appointment_time) {
      if (typeof formattedAppointment.appointment_time === 'string') {
        const timeParts = formattedAppointment.appointment_time.split(':');
        if (timeParts.length >= 2) {
          formattedAppointment.appointment_time = `${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
        }
      }
    }

    return res.status(201).json(formattedAppointment);
  } catch (error) {
    console.error(`❌ Create appointment error: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to create appointment'
    });
  }
});

// Get all appointments (Admin only)
router.get('/admin', getCurrentUser, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = {};
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const { count, rows: appointments } = await Appointment.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'student',
          attributes: ['id', 'full_name', 'email'],
          required: false, // Left join for better performance
          include: [
            {
              model: Student,
              as: 'studentProfile',
              attributes: ['school_institute_name', 'contact_number', 'first_name', 'last_name'],
              required: false // Left join for better performance
            }
          ]
        }
      ],
      order: [
        // Order by status priority: PENDING (1), CONFIRMED (2), COMPLETED (3), CANCELLED (4)
        [Sequelize.literal(`CASE 
          WHEN status = 'PENDING' THEN 1 
          WHEN status = 'CONFIRMED' THEN 2 
          WHEN status = 'COMPLETED' THEN 3 
          WHEN status = 'CANCELLED' THEN 4 
          ELSE 5 
        END`), 'ASC'],
        ['appointment_date', 'ASC'],
        ['appointment_time', 'ASC']
      ],
      limit: parseInt(limit),
      offset: offset,
      distinct: true, // Avoid duplicate count issues with joins
      subQuery: false // Better performance for complex queries
    });

    // Format appointments to ensure date/time are in consistent format
    const formattedAppointments = appointments.map(apt => {
      const appointment = apt.toJSON();
      // Ensure date is in YYYY-MM-DD format
      if (appointment.appointment_date) {
        if (appointment.appointment_date instanceof Date) {
          appointment.appointment_date = appointment.appointment_date.toISOString().split('T')[0];
        } else if (typeof appointment.appointment_date === 'string' && appointment.appointment_date.includes('T')) {
          appointment.appointment_date = appointment.appointment_date.split('T')[0];
        }
      }
      // Ensure time is in HH:MM format (remove seconds if present)
      if (appointment.appointment_time) {
        if (typeof appointment.appointment_time === 'string') {
          const timeParts = appointment.appointment_time.split(':');
          if (timeParts.length >= 2) {
            appointment.appointment_time = `${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
          }
        }
      }
      return appointment;
    });

    return res.json({
      appointments: formattedAppointments,
      pagination: {
        total_records: count,
        total_pages: Math.ceil(count / parseInt(limit)),
        current_page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error(`❌ Get appointments error: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get appointments'
    });
  }
});

// Get appointments for counsellor
router.get('/counsellor', getCurrentUser, async (req, res) => {
  try {
    // Counsellors can see all appointments (same as admin view)
    const { page = 1, limit = 25, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = {};
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const { count, rows: appointments } = await Appointment.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'student',
          attributes: ['id', 'full_name', 'email'],
          required: false, // Left join for better performance
          include: [
            {
              model: Student,
              as: 'studentProfile',
              attributes: ['school_institute_name', 'contact_number', 'first_name', 'last_name'],
              required: false // Left join for better performance
            }
          ]
        }
      ],
      order: [
        // Order by status priority: PENDING (1), CONFIRMED (2), COMPLETED (3), CANCELLED (4)
        [Sequelize.literal(`CASE 
          WHEN status = 'PENDING' THEN 1 
          WHEN status = 'CONFIRMED' THEN 2 
          WHEN status = 'COMPLETED' THEN 3 
          WHEN status = 'CANCELLED' THEN 4 
          ELSE 5 
        END`), 'ASC'],
        ['appointment_date', 'ASC'],
        ['appointment_time', 'ASC']
      ],
      limit: parseInt(limit),
      offset: offset,
      distinct: true, // Avoid duplicate count issues with joins
      subQuery: false // Better performance for complex queries
    });

    // Format appointments to ensure date/time are in consistent format
    const formattedAppointments = appointments.map(apt => {
      const appointment = apt.toJSON();
      // Ensure date is in YYYY-MM-DD format
      if (appointment.appointment_date) {
        if (appointment.appointment_date instanceof Date) {
          appointment.appointment_date = appointment.appointment_date.toISOString().split('T')[0];
        } else if (typeof appointment.appointment_date === 'string' && appointment.appointment_date.includes('T')) {
          appointment.appointment_date = appointment.appointment_date.split('T')[0];
        }
      }
      // Ensure time is in HH:MM format (remove seconds if present)
      if (appointment.appointment_time) {
        if (typeof appointment.appointment_time === 'string') {
          const timeParts = appointment.appointment_time.split(':');
          if (timeParts.length >= 2) {
            appointment.appointment_time = `${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
          }
        }
      }
      return appointment;
    });

    return res.json({
      appointments: formattedAppointments,
      pagination: {
        total_records: count,
        total_pages: Math.ceil(count / parseInt(limit)),
        current_page: parseInt(page),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error(`❌ Get counsellor appointments error: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to get appointments'
    });
  }
});

// Update appointment status (Admin/Counsellor)
router.patch('/:id/status', getCurrentUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !Object.values(AppointmentStatus).includes(status)) {
      return res.status(400).json({
        detail: 'Valid status is required'
      });
    }

    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({
        detail: 'Appointment not found'
      });
    }

    appointment.status = status;
    await appointment.save();

    // Fetch updated appointment with details
    const updatedAppointment = await Appointment.findOne({
      where: { id: appointment.id },
      include: [
        {
          model: User,
          as: 'student',
          attributes: ['id', 'full_name', 'email'],
          include: [
            {
              model: Student,
              as: 'studentProfile',
              attributes: ['school_institute_name', 'contact_number', 'first_name', 'last_name']
            }
          ]
        }
      ]
    });

    // Format the response to ensure consistent date/time format
    const formattedAppointment = updatedAppointment.toJSON();
    if (formattedAppointment.appointment_date) {
      if (formattedAppointment.appointment_date instanceof Date) {
        formattedAppointment.appointment_date = formattedAppointment.appointment_date.toISOString().split('T')[0];
      } else if (typeof formattedAppointment.appointment_date === 'string' && formattedAppointment.appointment_date.includes('T')) {
        formattedAppointment.appointment_date = formattedAppointment.appointment_date.split('T')[0];
      }
    }
    if (formattedAppointment.appointment_time) {
      if (typeof formattedAppointment.appointment_time === 'string') {
        const timeParts = formattedAppointment.appointment_time.split(':');
        if (timeParts.length >= 2) {
          formattedAppointment.appointment_time = `${timeParts[0].padStart(2, '0')}:${timeParts[1].padStart(2, '0')}`;
        }
      }
    }

    return res.json(formattedAppointment);
  } catch (error) {
    console.error(`❌ Update appointment status error: ${error.message}`);
    return res.status(500).json({
      detail: 'Failed to update appointment status'
    });
  }
});

module.exports = router;

