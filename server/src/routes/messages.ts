import { Router, Response } from 'express';
import { Message } from '../models/Message.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { Chat } from '../models/Chat.js';

const router = Router();

// Get message history for a specific chat
router.get('/:chatId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;
    const { limit = 50, skip = 0 } = req.query;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Verify user is a participant of the chat
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.participants.some(p => p.toString() === userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await Message.find({
      chatId
    })
    .sort({ createdAt: -1 })
    .skip(Number(skip))
    .limit(Number(limit));

    // Return in chronological order
    res.json(messages.reverse());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark messages as read in a chat
router.post('/:chatId/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await Message.updateMany(
      { chatId, senderId: { $ne: userId }, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
