import mongoose, { Document, Schema } from 'mongoose';

export type InteractionType = 
  | 'like' 
  | 'unlike' 
  | 'comment' 
  | 'share' 
  | 'view' 
  | 'complete_view' 
  | 'replay' 
  | 'skip' 
  | 'save' 
  | 'unsave'
  | 'like_rewarded'
  | 'view_rewarded';

export interface IInteraction extends Document {
  userId: mongoose.Types.ObjectId;
  videoId: mongoose.Types.ObjectId;
  type: InteractionType;
  watchDuration?: number; // in seconds
  metadata?: Record<string, any>;
  createdAt: Date;
}

const InteractionSchema = new Schema<IInteraction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
    type: { 
      type: String, 
      enum: ['like', 'unlike', 'comment', 'share', 'view', 'complete_view', 'replay', 'skip', 'save', 'unsave', 'like_rewarded', 'view_rewarded'], 
      required: true 
    },
    watchDuration: { type: Number },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexes for fast querying in recommendation engine
InteractionSchema.index({ userId: 1, createdAt: -1 });
InteractionSchema.index({ videoId: 1, type: 1 });
// Only the reward markers are unique. Plain 'view' rows must stay repeatable,
// so the constraint is partial: a user can view a video many times but can be
// paid for it at most once per video.
InteractionSchema.index(
  { userId: 1, videoId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: { $in: ['like_rewarded', 'view_rewarded'] } } }
);

export const Interaction = mongoose.model<IInteraction>('Interaction', InteractionSchema);
