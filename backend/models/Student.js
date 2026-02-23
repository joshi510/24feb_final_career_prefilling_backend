const { DataTypes } = require('sequelize');
const { sequelize } = require('../database');

const Student = sequelize.define('Student', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  contact_number: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true
  },
  parent_contact_number: {
    type: DataTypes.STRING(10),
    allowNull: false
  },
  school_institute_name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  current_education: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  stream: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  family_annual_income: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  date_of_birth: {
    type: DataTypes.DATE,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  mobile_number: {
    type: DataTypes.STRING(15),
    allowNull: true,
    unique: true
  },
  education: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'students',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true
});

module.exports = { Student };

