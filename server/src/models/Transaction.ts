import mongoose, { Document, Schema } from 'mongoose';

export type TransactionType = 'gift' | 'withdrawal' | 'deposit' | 'referral' | 'mining' | 'system_sweep';
export type PayoutMethod = 'zinli' | 'airtm' | 'crypto' | 'zelle' | 'paypal' | 'bank' | 'binance' | 'reserve' | 'airbnb';

export interface ITransaction extends Document {
  senderId?: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number; // USD value
  coins?: number;
  fee: number; // Platform cut
  agencyFee?: number; // Agency cut if applicable
  status: 'pending' | 'completed' | 'failed';
  method?: PayoutMethod;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: 'User' },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['gift', 'withdrawal', 'deposit', 'referral', 'mining', 'system_sweep'], required: true },
    amount: { type: Number, required: true },
    coins: { type: Number },
    fee: { type: Number, default: 0 },
    agencyFee: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    method: { type: String, enum: ['zinli', 'airtm', 'crypto', 'zelle', 'paypal', 'bank', 'binance', 'reserve', 'airbnb'] },
    idempotencyKey: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

TransactionSchema.index({ receiverId: 1, createdAt: -1 });
TransactionSchema.index({ senderId: 1, createdAt: -1 });

// Sparse + unique: a retried webhook or a double-submitted form cannot create a
// second row for the same logical payment. Sparse so existing rows without a key
// still validate.
TransactionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'idempotencyKey_unique' }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
