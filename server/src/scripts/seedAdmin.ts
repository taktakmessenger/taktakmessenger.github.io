import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/taktak';

async function seedAdmin() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Conectado a MongoDB Atlas...');

    const adminData = {
      username: 'manchita1976',
      phone: '+584146487704',
      email: 'elmalayaso7@gmail.com',
      password: 'InitialPassword123!',
      isOwner: true,
      isAdmin: true,
      isVerified: true,
      economicBalance: 0,
      minedCoins: 500, // Initial balance
      boughtCoins: 0,
      referralCode: 'MAN-7704',
      dateOfBirth: new Date('1976-01-01'),
      legalAgreementAccepted: true,
      privacyPolicyAccepted: true,
      recoveryPhraseHash: '$2a$10$667cHWtTWIHIyl5r5Tg18.MVRA7ww5yKRMNHSLx2vkUQeKEj8W4d6' // 12 generic words
    };

    const salt = await bcrypt.genSalt(10);
    adminData.password = await bcrypt.hash(adminData.password, salt);

    // Try to update existing or create new
    const user = await User.findOneAndUpdate(
      { $or: [{ phone: adminData.phone }, { email: adminData.email }] },
      adminData,
      { upsert: true, new: true }
    );

    console.log('Usuario administrador (manchita1976) sincronizado:', user.username);
    process.exit(0);
  } catch (error) {
    console.error('Error seeding admin:', error);
    process.exit(1);
  }
}

seedAdmin();
