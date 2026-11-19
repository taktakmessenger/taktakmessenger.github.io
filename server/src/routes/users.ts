import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { miningService } from '../services/mining.js';
import { User } from '../models/User.js';
import bcrypt from 'bcryptjs';

const router = Router();

router.post('/checkin', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    // One reward per calendar day. The claim is a conditional update, so of two
    // simultaneous requests only the one that actually moves lastCheckinAt wins.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const claimed = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [{ lastCheckinAt: { $exists: false } }, { lastCheckinAt: { $lt: startOfDay } }],
      },
      { $set: { lastCheckinAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!claimed) {
      return res.status(409).json({ success: false, error: 'Ya reclamaste el check-in de hoy' });
    }

    const result = await miningService.rewardActivity(userId, 'checkin');
    res.json({ success: true, reward: result?.reward });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Set Security Question
router.post('/security-questions', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { question, answer } = req.body;
    const userId = req.user?.id;

    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }

    const hashedAnswer = await bcrypt.hash(answer, 12);

    await User.findByIdAndUpdate(userId, {
      securityQuestion: question,
      securityAnswer: hashedAnswer
    });

    res.json({ success: true, message: 'Security question set successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

import { kycUpload } from '../middleware/kycUpload.js';

// KYC / Verification Upload (for Agencies)
router.post('/kyc', authMiddleware, kycUpload.fields([
  { name: 'idPhoto', maxCount: 1 },
  { name: 'facePhoto', maxCount: 1 }
]), async (req: AuthRequest, res: Response) => {
  try {
    const { taxId } = req.body;
    const userId = req.user?.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    const updateData: any = {
      kycData: {
        taxId,
        status: 'pending'
      }
    };

    if (files['idPhoto']) {
      updateData.kycData.idPhoto = files['idPhoto'][0].path;
    }
    if (files['facePhoto']) {
      updateData.kycData.facePhoto = files['facePhoto'][0].path;
    }

    await User.findByIdAndUpdate(userId, updateData);

    // Reward User & Mother Wallet (Mining Split).
    // Only the first submission pays: resubmitting the same KYC used to grant
    // 45 coins every time. The conditional update makes the claim atomic.
    try {
      const claim = await User.findOneAndUpdate(
        { _id: userId, 'kycData.verifiedAt': { $exists: false } },
        { $set: { 'kycData.verifiedAt': new Date() } },
        { returnDocument: 'before' }
      );
      if (claim) {
        await miningService.rewardActionWithSplit(userId!, 'verification');
      }
    } catch (rewardError) {
      console.error('Failed to process mining reward for verification:', rewardError);
    }

    res.json({ success: true, message: 'KYC data submitted for review' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
