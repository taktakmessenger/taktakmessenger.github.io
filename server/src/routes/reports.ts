import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { moderationService, REPORT_REASONS } from '../services/moderation.js';

const router = Router();

router.get('/reasons', (req, res: Response) => {
  res.json({ success: true, reasons: REPORT_REASONS });
});

router.post('/video/:videoId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { videoId } = req.params;
    const { reason, details } = req.body;
    const userId = req.user?.id;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await moderationService.reportVideo(videoId, userId!, reason, details);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/user/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { reason, details } = req.body;
    const reporterId = req.user?.id;

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const result = await moderationService.reportUser(reporterId!, userId, reason, details);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/block/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const blockerId = req.user?.id;

    const result = await moderationService.blockUser(blockerId!, userId);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/unblock/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const blockerId = req.user?.id;

    const result = await moderationService.unblockUser(blockerId!, userId);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/blocked', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    const blockedUsers = await moderationService.getBlockedUsers(userId!);

    res.json({ success: true, users: blockedUsers });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/flagged', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const threshold = parseInt(req.query.threshold as string) || 5;
    const flaggedContent = await moderationService.getFlaggedContent(threshold);

    res.json({ success: true, content: flaggedContent });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/video/:videoId/hide', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { videoId } = req.params;
    const userId = req.user?.id;

    const result = await moderationService.hideVideo(videoId, userId!);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/video/:videoId/restore', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { videoId } = req.params;
    const adminId = req.user?.id;

    const result = await moderationService.restoreVideo(videoId, adminId!);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/video/:videoId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { videoId } = req.params;
    const adminId = req.user?.id;

    const result = await moderationService.deleteVideoPermanently(videoId, adminId!);

    res.json({ ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
