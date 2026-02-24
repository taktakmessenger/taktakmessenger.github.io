import mongoose, { Document, Schema } from 'mongoose';

export interface IChat extends Document {
  participants: mongoose.Types.ObjectId[];
  lastMessage?: mongoose.Types.ObjectId;
  lastMessageAt?: Date;
  unreadCounts: Map<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const chatSchema = new Schema<IChat>({
  participants: [{ 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  }],
  lastMessage: { 
    type: Schema.Types.ObjectId, 
    ref: 'Message' 
  },
  lastMessageAt: { type: Date },
  unreadCounts: {
    type: Map,
    of: Number,
    default: {}
  }
}, { 
  timestamps: true 
});

// Compound index for finding chats with a user
chatSchema.index({ participants: 1 });

export const Chat = mongoose.model<IChat>('Chat', chatSchema);
