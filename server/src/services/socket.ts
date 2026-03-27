import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';

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

    // Handle sending messages
    socket.on('send_message', (data: {
      chatId: string;
      content: string;
      type: string;
    }) => {
      // Broadcast to chat room
      io.to(`chat:${data.chatId}`).emit('new_message', {
        ...data,
        senderId: socket.userId,
        createdAt: new Date()
      });
    });

    // Handle typing indicators
    socket.on('typing', (data: { chatId: string; isTyping: boolean }) => {
      socket.to(`chat:${data.chatId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping: data.isTyping
      });
    });

    // Handle read receipts
    socket.on('mark_read', (data: { chatId: string; messageId: string }) => {
      io.to(`chat:${data.chatId}`).emit('messages_read', {
        userId: socket.userId,
        messageId: data.messageId
      });
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
