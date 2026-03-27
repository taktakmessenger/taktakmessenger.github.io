import mongoose, { Document, Schema } from 'mongoose';

export interface IVideoComment extends Document {
  videoId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  parentId?: mongoose.Types.ObjectId;
  text: string;
  likes: number;
  likedBy: mongoose.Types.ObjectId[];
  replies: mongoose.Types.ObjectId[];
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const VideoCommentSchema = new Schema<IVideoComment>(
  {
    videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'VideoComment' },
    text: { type: String, required: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    replies: [{ type: Schema.Types.ObjectId, ref: 'VideoComment' }],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

VideoCommentSchema.index({ videoId: 1, createdAt: -1 });
VideoCommentSchema.index({ parentId: 1 });

export const VideoComment = mongoose.model<IVideoComment>(
  'VideoComment',
  VideoCommentSchema
);
