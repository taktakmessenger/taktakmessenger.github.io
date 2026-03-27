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
  reports: Array<{
    reporterId: mongoose.Types.ObjectId;
    reason: string;
    details?: string;
    createdAt: Date;
  }>;
  blockedUsers: mongoose.Types.ObjectId[];
  blockedBy: mongoose.Types.ObjectId[];
  isBanned: boolean;
  bannedUntil?: Date;
  isWhaleOrBot: boolean;
  whaleOrBotSince?: Date;
  balance: number; // USD balance (from gifts/mined conversion)
  purchasedCoins: number; // Spend-only coins
  minedCoins: number; // Potentially withdrawable coins
  isAgencyMember: boolean;
  agencyId?: mongoose.Types.ObjectId;
  dailyMiningAmount: number;
  lastMiningDate?: Date;
  dailyWithdrawalAmount: number;
  lastWithdrawalDate?: Date;
  securityQuestion?: string;
  securityAnswer?: string; // Hashed
  recoveryPhraseHash?: string; // Hashed 12 words
  kycData?: {
    idPhoto?: string;
    facePhoto?: string;
    taxId?: string; // RIF/NIT/etc.
    verifiedAt?: Date;
    status: 'pending' | 'verified' | 'rejected' | 'none';
  };
  watchedViewsCount: number;
  bmIncentivo: number; // Admin incentive (TTC-R)
  miningPoints: {
    viewer: number;
    creator: number;
    node: number;
  };
  dateOfBirth?: Date;
  legalAgreementAccepted: boolean;
  privacyPolicyAccepted: boolean;
  referralCode?: string;
  referredBy?: mongoose.Types.ObjectId;
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
  },
  reports: [{
    reporterId: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String },
    details: { type: String },
    createdAt: { type: Date, default: Date.now }
  }],
  blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  blockedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  isBanned: { type: Boolean, default: false },
  bannedUntil: { type: Date },
  isWhaleOrBot: { type: Boolean, default: false },
  whaleOrBotSince: { type: Date },
  balance: { type: Number, default: 0 },
  purchasedCoins: { type: Number, default: 0 },
  minedCoins: { type: Number, default: 0 },
  isAgencyMember: { type: Boolean, default: false },
  agencyId: { type: Schema.Types.ObjectId, ref: 'User' },
  dailyMiningAmount: { type: Number, default: 0 },
  lastMiningDate: { type: Date },
  dailyWithdrawalAmount: { type: Number, default: 0 },
  lastWithdrawalDate: { type: Date },
  securityQuestion: { type: String },
  securityAnswer: { type: String, select: false },
  recoveryPhraseHash: { type: String, select: false },
  kycData: {
    idPhoto: { type: String },
    facePhoto: { type: String },
    taxId: { type: String },
    verifiedAt: { type: Date },
    status: { type: String, enum: ['pending', 'verified', 'rejected', 'none'], default: 'none' }
  },
  watchedViewsCount: { type: Number, default: 0 },
  bmIncentivo: { type: Number, default: 0 },
  miningPoints: {
    viewer: { type: Number, default: 0 },
    creator: { type: Number, default: 0 },
    node: { type: Number, default: 0 }
  },
  dateOfBirth: { type: Date },
  legalAgreementAccepted: { type: Boolean, default: false },
  privacyPolicyAccepted: { type: Boolean, default: false },
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: Schema.Types.ObjectId, ref: 'User' }
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
