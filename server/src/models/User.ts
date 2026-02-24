import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  username: string;
  email?: string;
  phone: string;
  password: string;
  avatar: string;
  bio?: string;
  isVerified: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  verificationCode?: string;
  verificationCodeExpires?: Date;
  refreshToken?: string;
  devices: Array<{
    deviceId: string;
    name: string;
    lastSeen: Date;
  }>;
  privacySettings: {
    lastSeen: 'everyone' | 'contacts' | 'nobody';
    profilePhoto: 'everyone' | 'contacts' | 'nobody';
    readReceipts: boolean;
    typingIndicators: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    sparse: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    sparse: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  avatar: { type: String, default: '' },
  bio: { type: String, maxlength: 500 },
  isVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  isOwner: { type: Boolean, default: false },
  verificationCode: { type: String },
  verificationCodeExpires: { type: Date },
  refreshToken: { type: String, select: false },
  devices: [{
    deviceId: String,
    name: String,
    lastSeen: Date
  }],
  privacySettings: {
    lastSeen: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    profilePhoto: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
    readReceipts: { type: Boolean, default: true },
    typingIndicators: { type: Boolean, default: true }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret: any) => {
      delete ret.password;
      delete ret.refreshToken;
      delete ret.verificationCode;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

export const User = mongoose.model<IUser>('User', userSchema);
