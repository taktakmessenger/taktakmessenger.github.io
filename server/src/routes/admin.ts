import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { User } from '../models/User.js';

const router = Router();

// Get pending KYC requests
router.get('/kyc/pending', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role.includes('admin')) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const pendingKyc = await User.find({ 'kycData.status': 'pending' })
      .select('username phone email kycData');

    res.json({ success: true, count: pendingKyc.length, data: pendingKyc });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Approve KYC
router.post('/kyc/approve/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role.includes('admin')) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { userId } = req.params;
    await User.findByIdAndUpdate(userId, {
      'kycData.status': 'verified',
      'kycData.verifiedAt': new Date()
    });

    res.json({ success: true, message: 'KYC aprobado exitosamente' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reject KYC
router.post('/kyc/reject/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.role.includes('admin')) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    const { userId } = req.params;
    const { reason } = req.body;

    await User.findByIdAndUpdate(userId, {
      'kycData.status': 'rejected'
    });

    res.json({ success: true, message: 'KYC rechazado' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
