import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not found in .env');
  process.exit(1);
}

async function setPassword() {
  try {
    await mongoose.connect(MONGODB_URI as string);
    console.log('Connected to MongoDB');

    const email = 'eliecerdepablos@gmail.com';
    const rawPassword = 'Taktak2026!';
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(rawPassword, 12);

    const result = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { $set: { password: hashedPassword } },
      { new: true }
    );

    if (result) {
      console.log(`Successfully updated password for ${email}`);
      console.log('User ID:', result._id);
    } else {
      console.log(`User ${email} not found`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

setPassword();
