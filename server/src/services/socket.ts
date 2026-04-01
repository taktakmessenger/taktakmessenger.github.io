import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { Message } from '../models/Message.js';
import { Chat } from '../models/Chat.js';
import mongoose from 'mongoose';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

export const setupSocketHandlers = (io: Server) => {
  // Authentication middleware
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { userId: string };
      socket.userId = decoded.userId;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`✅ Usuario conectado: ${socket.userId}`);

    // Join user's personal room
    socket.join(`user:${socket.userId}`);

    // Handle joining chat rooms
    socket.on('join_chat', (chatId: string) => {
      socket.join(`chat:${chatId}`);
      console.log(`👤 Usuario ${socket.userId} se unió al chat ${chatId}`);
    });

    // Handle leaving chat rooms
    socket.on('leave_chat', (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    // Handle sending messages (With DB Persistence)
    socket.on('send_message', async (data: {
      chatId: string;
      content: string;
      type: 'text' | 'image' | 'video' | 'audio' | 'file';
    }) => {
      try {
        if (!socket.userId) return;

        // 1. Create and save message
        const message = new Message({
          chatId: data.chatId,
          senderId: socket.userId,
          content: data.content,
          type: data.type || 'text',
          isRead: false
        });

        const savedMessage = await message.save();

        // 2. Update chat last message
        await Chat.findByIdAndUpdate(data.chatId, {
          lastMessage: savedMessage._id,
          lastMessageAt: savedMessage.createdAt
        });

        // 3. Broadcast to chat room
        const messageData = {
          id: savedMessage._id,
          chatId: data.chatId,
          senderId: socket.userId,
          content: data.content,
          type: data.type || 'text',
          createdAt: savedMessage.createdAt,
          isRead: false
        };

        io.to(`chat:${data.chatId}`).emit('new_message', messageData);
        
        // Also notify participants who aren't in the room (notifications)
        const chat = await Chat.findById(data.chatId);
        if (chat) {
          chat.participants.forEach(participantId => {
            if (participantId.toString() !== socket.userId) {
              io.to(`user:${participantId}`).emit('notification', {
                type: 'chat_message',
                chatId: data.chatId,
                senderId: socket.userId,
                content: data.content,
                messageId: savedMessage._id
              });
            }
          });
        }
      } catch (error) {
        console.error('Socket send_message error:', error);
      }
    });

    // Handle typing indicators
    socket.on('typing', (data: { chatId: string; isTyping: boolean }) => {
      socket.to(`chat:${data.chatId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping: data.isTyping
      });
    });

    // Handle read receipts
    socket.on('mark_read', async (data: { chatId: string; messageId: string }) => {
      try {
        await Message.findByIdAndUpdate(data.messageId, {
          isRead: true,
          readAt: new Date()
        });

        io.to(`chat:${data.chatId}`).emit('messages_read', {
          userId: socket.userId,
          messageId: data.messageId
        });
      } catch (err) {
        console.error('Socket mark_read error:', err);
      }
    });

    // Voice call signaling
    socket.on('call_user', (data: { userId: string; signalData: any; callType: 'voice' | 'video' }) => {
      io.to(`user:${data.userId}`).emit('incoming_call', {
        from: socket.userId,
        signalData: data.signalData,
        callType: data.callType
      });
    });

    socket.on('accept_call', (data: { userId: string; signalData: any }) => {
      io.to(`user:${data.userId}`).emit('call_accepted', {
        signalData: data.signalData
      });
    });

    socket.on('reject_call', (data: { userId: string }) => {
      io.to(`user:${data.userId}`).emit('call_rejected', {
        from: socket.userId
      });
    });

    socket.on('end_call', (data: { userId: string }) => {
      io.to(`user:${data.userId}`).emit('call_ended', {
        from: socket.userId
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`👋 Usuario desconectado: ${socket.userId}`);
    });
  });
};

export default setupSocketHandlers;
