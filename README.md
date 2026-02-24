# TakTak - Modern TikTok Clone & Poker Platform

TakTak is a high-performance, mobile-ready TikTok clone integrated with a social poker platform. Built with modern technologies, it offers a secure, immersive, and interactive experience.

## 🚀 Features

- **Video Feed**: Seamless vertical video scrolling with smooth transitions.
- **TakTak Poker**: Integrated social poker experience for real-time interaction.
- **Messenger**: Secure encrypted chat and group messaging.
- **Mobile First**: Fully compatible with Android via Capacitor integration.
- **Security**: Built-in AES-256 encryption and secure authentication system.
- **Discover & Creator Tools**: Advanced content discovery and video creation views.
- **Admin Panel**: Owners can manage the platform through a dedicated dashboard.

## 🛠 Tech Stack

### Frontend

- **React 19** + **TypeScript**
- **Vite 7** (Fast HMR)
- **Tailwind CSS** + **shadcn/ui**
- **Framer Motion** (Animations)
- **Capacitor** (Mobile support)
- **Zustand** (State management)

### Backend

- **Node.js** + **Express**
- **MongoDB** (via Mongoose)
- **Socket.io** (Real-time updates)
- **Twilio** (OTP support)
- **JWT** (Secure authentication)

## 📦 Installation & Setup

### 1. Prerequisites

- Node.js 20+
- MongoDB instance (local or Atlas)

### 2. Frontend Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for web
npm run build
```

### 3. Backend Setup

```bash
cd server

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev
```

### 4. Mobile (Android)

```bash
# Build and sync with Android Studio
npm run build:mobile
```

## 🔐 Security

This project implements advanced security measures including:

- AES-256 Data Encryption
- Secure JWT-based Authentication
- Real-time Security Monitoring Overlay

---
*Created by the TakTak Team. Currently in Beta.*
