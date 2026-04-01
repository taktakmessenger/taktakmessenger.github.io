import { Router, Response } from 'express';
import { Chat } from '../models/Chat.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import mongoose from 'mongoose';

const router = Router();

// Get all chats for the authenticated user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const chats = await Chat.find({
      participants: userId
    })
    .populate('participants', 'username avatar bio')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

    res.json(chats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start a new chat or get existing one
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { participantId } = req.body;
    const userId = req.user?.id;

    if (!userId || !participantId) {
      return res.status(400).json({ error: 'User IDs are required' });
    }

    if (userId === participantId) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    // Check if chat already exists
    let chat = await Chat.findOne({
      participants: { $all: [userId, participantId], $size: 2 }
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        participants: [userId, participantId],
        unreadCounts: new Map([[userId, 0], [participantId, 0]])
      });
      await chat.save();
    }

    const populatedChat = await Chat.findById(chat._id)
      .populate('participants', 'username avatar bio')
      .populate('lastMessage');

    res.json(populatedChat);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get a specific chat by ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const chat = await Chat.findById(req.params.id)
      .populate('participants', 'username avatar bio')
      .populate('lastMessage');
    
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    
    // Check if user is a participant
    const isParticipant = chat.participants.some(p => p._id.toString() === req.user?.id);
    if (!isParticipant) return res.status(403).json({ error: 'Access denied' });

    res.json(chat);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
