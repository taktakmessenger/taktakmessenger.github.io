import mongoose, { Document, Schema } from 'mongoose';

export interface IVideo extends Document {
  userId: mongoose.Types.ObjectId;
  videoUrl: string;
  thumbnail: string;
  caption: string;
  music: {
    name: string;
    artist?: string;
    url?: string;
  };
  duration: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  downloads: number;
  gifts: number;
  watchTime: number;
  isPublic: boolean;
  isDeleted: boolean;
  magnetURI?: string;
  ipfsCID?: string;
  hashtags: string[];
  mentions: string[];
  likedBy: mongoose.Types.ObjectId[];
  savedBy: mongoose.Types.ObjectId[];
  reportedBy: mongoose.Types.ObjectId[];
  reports: {
    userId: mongoose.Types.ObjectId;
    reason: string;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const VideoSchema = new Schema<IVideo>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    videoUrl: { type: String, required: true },
    thumbnail: { type: String, default: '' },
    caption: { type: String, default: '' },
    music: {
      name: { type: String, default: 'original sound' },
      artist: { type: String },
      url: { type: String },
    },
    duration: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    gifts: { type: Number, default: 0 },
    watchTime: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    magnetURI: { type: String },
    ipfsCID: { type: String },
    hashtags: [String],
    mentions: [String],
    likedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    savedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reportedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reports: [
      {
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        reason: { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

VideoSchema.index({ createdAt: -1 });
VideoSchema.index({ userId: 1, createdAt: -1 });
VideoSchema.index({ likes: -1 });
VideoSchema.index({ views: -1 });
VideoSchema.index({ hashtags: 1 });
VideoSchema.index(
  { isPublic: 1, isDeleted: 1, createdAt: -1 },
  { name: 'feed_index' }
);

export const Video = mongoose.model<IVideo>('Video', VideoSchema);
