import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { Video } from '../models/Video.js';
import { VideoComment } from '../models/VideoComment.js';
import { Interaction } from '../models/Interaction.js';
import { recommendationService } from '../services/recommendation.js';
import { videoProcessingService } from '../services/videoProcessing.js';
import { miningService } from '../services/mining.js';
import { moderationService } from '../services/moderation.js';
import { authMiddleware, optionalAuth, AuthRequest } from '../middleware/auth.js';
import mongoose from 'mongoose';

interface CustomMulterRequest extends Request {
  file?: Express.Multer.File;
  user?: {
    id: string;
    username: string;
    email: string;
    role: string;
  };
}

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP4, MOV, and WebM are allowed.'));
    }
  },
});

router.post(
  '/upload',
  authMiddleware,
  upload.single('video'),
  async (req: CustomMulterRequest, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded' });
      }

      const { caption, music, hashtags } = req.body;
      const userId = req.user?.id;

      const processedVideo = await videoProcessingService.processVideo(
        req.file.path
      );

      const hashtagsArray = hashtags
        ? hashtags
            .toString()
            .split(',')
            .map((t: string) => t.trim().toLowerCase())
        : [];

      const video = new Video({
        userId: new mongoose.Types.ObjectId(userId),
        videoUrl: processedVideo.processedPaths.high || req.file.path,
        thumbnail: processedVideo.thumbnailPath,
        caption: caption || '',
        music: music
          ? JSON.parse(music)
          : { name: 'original sound', artist: req.user?.username },
        duration: processedVideo.duration,
        hashtags: hashtagsArray,
        magnetURI: processedVideo.magnetURI,
        ipfsCID: processedVideo.ipfsCID,
      });

      await video.save();

      // Child Safety Scan
      const isMinorDetected = await moderationService.detectMinors(
        video._id.toString(),
        video.videoUrl
      );

      if (isMinorDetected) {
        await moderationService.handleMinorViolation(userId!, video._id.toString());
        // Remove the video for safety
        await Video.findByIdAndDelete(video._id);
        return res.status(403).json({
          error: 'Content violation: Minor detected. Your account has been suspended for 2 days.',
          success: false
        });
      }

      videoProcessingService.cleanupTempFiles([req.file.path]);

      // Reward User & Mother Wallet (Mining Split)
      try {
        await miningService.rewardActionWithSplit(userId!, 'video_upload');
      } catch (rewardError) {
        console.error('Failed to process mining reward for video upload:', rewardError);
        // We don't fail the upload if the reward fails, but we log it.
      }

      res.status(201).json({
        success: true,
        video: {
          id: video._id,
          userId: video.userId,
          username: req.user?.username || 'unknown',
          userAvatar: (req.user as any)?.avatar || 'https://i.pravatar.cc/150?u=' + userId,
          videoUrl: video.videoUrl,
          thumbnail: video.thumbnail,
          caption: video.caption,
          likes: 0,
          comments: 0,
          shares: 0,
          gifts: 0,
          isLiked: false,
          isFollowing: false,
          createdAt: video.createdAt,
        },
      });
    } catch (error) {
      console.error('Video upload error:', error);
      res.status(500).json({ error: 'Failed to upload video' });
    }
  }
);

router.get('/feed', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;
    const userId = req.query.userId as string | null;

    const videos = await recommendationService.getForYouFeed(userId, page, limit);

    res.json({ success: true, videos, page, limit });
  } catch (error) {
    console.error('Feed error:', error);
    res.status(500).json({ error: 'Failed to get feed' });
  }
});

router.get('/trending', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;

    const videos = await recommendationService.getTrendingVideos(page, limit);

    res.json({ success: true, videos, page, limit });
  } catch (error) {
    console.error('Trending error:', error);
    res.status(500).json({ error: 'Failed to get trending videos' });
  }
});

router.get('/hashtag/:tag', async (req: Request, res: Response) => {
  try {
    const { tag } = req.params;
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;

    const videos = await recommendationService.getVideosByHashtag(tag, page, limit);

    res.json({ success: true, videos, page, limit });
  } catch (error) {
    console.error('Hashtag error:', error);
    res.status(500).json({ error: 'Failed to get videos by hashtag' });
  }
});

router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 10;

    const videos = await Video.find({
      userId: new mongoose.Types.ObjectId(userId),
      isPublic: true,
      isDeleted: false,
    })
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .populate('userId', 'username avatar')
      .lean();

    res.json({ success: true, videos, page, limit });
  } catch (error) {
    console.error('User videos error:', error);
    res.status(500).json({ error: 'Failed to get user videos' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const video = await Video.findById(id)
      .populate('userId', 'username avatar followers following isVerified')
      .lean();

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ success: true, video });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// Record view and reward user
router.post('/:id/view', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { watchTime, userId } = req.body;

    const video = await Video.findByIdAndUpdate(
      id,
      {
        $inc: { views: 1 },
        $set: { 'metadata.lastWatchTime': watchTime },
      },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Reward the viewer if logged in
    const viewerId = req.user?.id || userId;
    if (viewerId) {
      await miningService.rewardActivity(viewerId.toString(), 'view');
    }

    // Log interaction
    if (viewerId) {
      const type = (watchTime >= video.duration * 0.9) ? 'complete_view' : 'view';
      await Interaction.create({
        userId: new mongoose.Types.ObjectId(viewerId.toString()),
        videoId: video._id,
        type,
        watchDuration: watchTime,
      });
    }

    res.json({ success: true, views: video.views });
  } catch (error) {
    console.error('View error:', error);
    res.status(500).json({ error: 'Failed to record view' });
  }
});

// Record share
router.post('/:id/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { shares: 1 } });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ success: true, shares: (video.shares || 0) + 1 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Record download
router.post('/:id/download', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } });
    if (!video) return res.status(404).json({ error: 'Video not found' });
    
    // Reward creator for download (viral metrics)
    if (video.userId) {
      await miningService.rewardActivity(video.userId.toString(), 'receive_like');
    }

    res.json({ success: true, downloads: (video.downloads || 0) + 1 });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/like', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const video = await Video.findById(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const likedIndex = video.likedBy.findIndex(
      (uid) => uid.toString() === userId
    );

    if (likedIndex > -1) {
      video.likedBy.splice(likedIndex, 1);
      video.likes = Math.max(0, video.likes - 1);
    } else {
      video.likedBy.push(new mongoose.Types.ObjectId(userId));
      video.likes += 1;
    }

    await video.save();

    // Log interaction
    await Interaction.create({
      userId: new mongoose.Types.ObjectId(userId),
      videoId: video._id,
      type: likedIndex === -1 ? 'like' : 'unlike',
    });

    res.json({
      success: true,
      liked: likedIndex === -1,
      likes: video.likes,
    });

    // Reward for Like Activity
    if (likedIndex === -1) {
      // Reward the Liker
      miningService.rewardActivity(userId!, 'like');
      // Reward the Creator
      miningService.rewardActivity(video.userId.toString(), 'receive_like');
    }
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Failed to like video' });
  }
});

router.post('/:id/comment', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { text, parentId } = req.body;
    const userId = req.user?.id;

    const video = await Video.findById(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const comment = new VideoComment({
      videoId: video._id,
      userId: new mongoose.Types.ObjectId(userId),
      parentId: parentId ? new mongoose.Types.ObjectId(parentId) : undefined,
      text,
    });

    await comment.save();

    if (parentId) {
      await VideoComment.findByIdAndUpdate(parentId, {
        $push: { replies: comment._id },
      });
    } else {
      video.comments += 1;
      await video.save();
    }

    // Log interaction
    await Interaction.create({
      userId: new mongoose.Types.ObjectId(userId),
      videoId: video._id,
      type: 'comment',
      metadata: { commentId: comment._id },
    });

    const populatedComment = await VideoComment.findById(comment._id)
      .populate('userId', 'username avatar')
      .lean();

    res.status(201).json({ success: true, comment: populatedComment });

    // Reward for Comment Activity
    miningService.rewardActivity(userId!, 'comment');
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

router.get('/:id/comments', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 0;
    const limit = parseInt(req.query.limit as string) || 20;

    const comments = await VideoComment.find({
      videoId: new mongoose.Types.ObjectId(id),
      parentId: undefined,
      isDeleted: false,
    })
      .populate('userId', 'username avatar')
      .sort({ createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean();

    res.json({ success: true, comments, page, limit });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to get comments' });
  }
});

router.post('/:id/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { platform } = req.body;

    const video = await Video.findByIdAndUpdate(
      id,
      { $inc: { shares: 1 } },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Log interaction
    if (req.user) {
      await Interaction.create({
        userId: new mongoose.Types.ObjectId(req.user.id),
        videoId: video._id,
        type: 'share',
        metadata: { platform },
      });
    }

    res.json({ success: true, shares: video.shares });
  } catch (error) {
    console.error('Share error:', error);
    res.status(500).json({ error: 'Failed to share video' });
  }
});

router.post('/:id/save', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const video = await Video.findById(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const savedIndex = video.savedBy.findIndex(
      (uid) => uid.toString() === userId
    );

    if (savedIndex > -1) {
      video.savedBy.splice(savedIndex, 1);
    } else {
      video.savedBy.push(new mongoose.Types.ObjectId(userId));
    }

    await video.save();

    // Log interaction
    await Interaction.create({
      userId: new mongoose.Types.ObjectId(userId),
      videoId: video._id,
      type: savedIndex === -1 ? 'save' : 'unsave',
    });

    res.json({
      success: true,
      saved: savedIndex === -1,
    });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save video' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const video = await Video.findOneAndUpdate(
      { _id: id, userId: new mongoose.Types.ObjectId(userId) },
      { isDeleted: true },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: 'Video not found or unauthorized' });
    }

    res.json({ success: true, message: 'Video deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

export default router;
