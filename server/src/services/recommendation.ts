import { Video } from '../models/Video.js';
import { Interaction, InteractionType } from '../models/Interaction.js';
import mongoose from 'mongoose';

interface UserInteraction {
  userId: string;
  interactions: { videoId: string; type: InteractionType }[];
  likedVideos: string[];
  viewedVideos: string[];
  completeViewVideos: string[];
  replayedVideos: string[];
  skippedVideos: string[];
  hashtags: string[];
  followedUsers: string[];
}

interface RecommendationScore {
  videoId: string;
  score: number;
  factors: {
    likes: number;
    comments: number;
    shares: number;
    views: number;
    recency: number;
    hashtags: number;
    followed: number;
  };
}

class RecommendationService {
  private weights = {
    likes: 0.3,
    comments: 0.15,
    shares: 0.25, 
    completeViews: 0.25,
    views: 0.05,
    replays: 0.1,
    skips: -0.3, // More aggressive skip penalty
    recency: 0.1,
    hashtags: 0.1,
    followed: 0.15,
  };

  async getUserInteractions(userId: string): Promise<UserInteraction> {
    const userInteractions: UserInteraction = {
      userId,
      interactions: [],
      likedVideos: [],
      viewedVideos: [],
      completeViewVideos: [],
      replayedVideos: [],
      skippedVideos: [],
      hashtags: [],
      followedUsers: [],
    };

    // Get recent interactions (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentInteractions = await Interaction.find({
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: thirtyDaysAgo },
    })
      .sort({ createdAt: -1 })
      .populate('videoId', 'hashtags')
      .lean();

    const videoHashTable: Record<string, number> = {};

    recentInteractions.forEach((interaction: any) => {
      const vid = interaction.videoId?._id?.toString();
      if (!vid) return;

      userInteractions.interactions.push({ videoId: vid, type: interaction.type });

      if (interaction.type === 'like') userInteractions.likedVideos.push(vid);
      if (interaction.type === 'view') userInteractions.viewedVideos.push(vid);
      if (interaction.type === 'complete_view') userInteractions.completeViewVideos.push(vid);
      if (interaction.type === 'replay') userInteractions.replayedVideos.push(vid);
      if (interaction.type === 'skip') userInteractions.skippedVideos.push(vid);

      if (interaction.videoId?.hashtags) {
        interaction.videoId.hashtags.forEach((tag: string) => {
          videoHashTable[tag] = (videoHashTable[tag] || 0) + 1;
        });
      }
    });

    // Sort hashtags by frequency
    userInteractions.hashtags = Object.entries(videoHashTable)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
      .slice(0, 20);

    return userInteractions;
  }

  calculateEngagementScore(video: any): number {
    const likeScore = Math.log10(video.likes + 1) * this.weights.likes;
    const commentScore = Math.log10(video.comments + 1) * this.weights.comments;
    const shareScore = Math.log10(video.shares + 1) * this.weights.shares;
    const viewScore = Math.log10(video.views + 1) * this.weights.views;

    return likeScore + commentScore + shareScore + viewScore;
  }

  calculateRecencyScore(createdAt: Date): number {
    const now = new Date();
    const ageInHours = (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
    const decayFactor = Math.exp(-0.1 * ageInHours);
    return decayFactor * this.weights.recency;
  }

  calculateTrendingBoost(video: any): number {
    // Boost videos with high engagement relative to their age
    const engagement = (video.likes || 0) + (video.comments || 0) * 2 + (video.shares || 0) * 3;
    const ageInHours = (Date.now() - new Date(video.createdAt).getTime()) / (1000 * 60 * 60);
    if (ageInHours < 1) return 0.2; // New video boost
    return Math.min(0.5, (engagement / (ageInHours + 1)) * 0.1);
  }

  calculateHashtagScore(videoHashtags: string[], userHashtags: string[]): number {
    if (!videoHashtags?.length || !userHashtags?.length) return 0;
    const matchingHashtags = videoHashtags.filter((tag) =>
      userHashtags.includes(tag)
    );
    return (matchingHashtags.length / videoHashtags.length) * this.weights.hashtags;
  }

  calculateFollowedScore(
    videoCreatorId: string,
    followedUsers: string[]
  ): number {
    if (!followedUsers?.length) return 0;
    return followedUsers.includes(videoCreatorId) ? this.weights.followed : 0;
  }

  async getRecommendedVideos(
    userId: string,
    page: number = 0,
    limit: number = 10
  ): Promise<RecommendationScore[]> {
    const userInteractions = await this.getUserInteractions(userId);

    const baseQuery = {
      isPublic: true,
      isDeleted: false,
      userId: { $ne: new mongoose.Types.ObjectId(userId) },
    };

    const videos = await Video.find(baseQuery)
      .populate('userId', 'username avatar')
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit * 3)
      .lean();

    const scores: RecommendationScore[] = videos.map((video) => {
      const vid = video._id.toString();
      
      const engagementScore = this.calculateEngagementScore(video);
      const recencyScore = this.calculateRecencyScore(video.createdAt);
      const hashtagScore = this.calculateHashtagScore(
        video.hashtags || [],
        userInteractions.hashtags
      );
      const followedScore = this.calculateFollowedScore(
        video.userId?._id?.toString() || '',
        userInteractions.followedUsers
      );
      const trendingBoost = this.calculateTrendingBoost(video);

      // Advanced User-Specific Scoring
      let userScore = 0;
      if (userInteractions.likedVideos.includes(vid)) userScore += this.weights.likes;
      if (userInteractions.completeViewVideos.includes(vid)) userScore += this.weights.completeViews;
      if (userInteractions.replayedVideos.includes(vid)) userScore += this.weights.replays;
      if (userInteractions.skippedVideos.includes(vid)) userScore += this.weights.skips;

      const totalScore =
        engagementScore +
        recencyScore +
        hashtagScore +
        followedScore +
        trendingBoost +
        userScore;

      return {
        videoId: vid,
        score: totalScore,
        factors: {
          likes: video.likes || 0,
          comments: video.comments || 0,
          shares: video.shares || 0,
          views: video.views || 0,
          recency: recencyScore,
          hashtags: hashtagScore,
          followed: followedScore,
        },
      };
    });

    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, limit);
  }

  async getTrendingVideos(page: number = 0, limit: number = 10) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const videos = await Video.aggregate([
      {
        $match: {
          isPublic: true,
          isDeleted: false,
          createdAt: { $gte: oneDayAgo },
        },
      },
      {
        $addFields: {
          trendingScore: {
            $add: [
              { $multiply: ['$likes', 1] },
              { $multiply: ['$comments', 2] },
              { $multiply: ['$shares', 3] },
              { $multiply: ['$views', 0.1] },
            ],
          },
        },
      },
      { $sort: { trendingScore: -1 } },
      { $skip: page * limit },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'creator',
        },
      },
      { $unwind: '$creator' },
      {
        $project: {
          _id: 1,
          videoUrl: 1,
          thumbnail: 1,
          caption: 1,
          music: 1,
          duration: 1,
          likes: 1,
          comments: 1,
          shares: 1,
          views: 1,
          trendingScore: 1,
          'creator.username': 1,
          'creator.avatar': 1,
          createdAt: 1,
        },
      },
    ]);

    return videos;
  }

  async getVideosByHashtag(
    hashtag: string,
    page: number = 0,
    limit: number = 10
  ) {
    const hashtagLower = hashtag.toLowerCase().replace('#', '');
    
    return Video.find({
      isPublic: true,
      isDeleted: false,
      hashtags: { $regex: hashtagLower, $options: 'i' },
    })
      .populate('userId', 'username avatar')
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();
  }

  async getForYouFeed(
    userId: string | null,
    page: number = 0,
    limit: number = 10
  ) {
    if (userId) {
      return this.getRecommendedVideos(userId, page, limit);
    } else {
      return this.getTrendingVideos(page, limit);
    }
  }
}

export const recommendationService = new RecommendationService();
