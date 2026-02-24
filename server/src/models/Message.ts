import mongoose, { Document, Schema } from 'mongoose';
import CryptoJS from 'crypto-js';

export interface IMessage extends Document {
  chatId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  content: string;
  encryptedContent?: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file';
  mediaUrl?: string;
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
}

const messageSchema = new Schema<IMessage>({
  chatId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Chat',
    required: true,
    index: true
  },
  senderId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  content: { 
    type: String, 
    required: true,
    maxlength: 10000
  },
  encryptedContent: { type: String },
  type: { 
    type: String, 
    enum: ['text', 'image', 'video', 'audio', 'file'],
    default: 'text'
  },
  mediaUrl: { type: String },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date }
}, { 
  timestamps: true 
});

// Index for faster queries
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });

export const Message = mongoose.model<IMessage>('Message', messageSchema);
