import { useEffect, useRef, useCallback } from 'react';
import { miningService } from '../services/MiningService';
import { useStore } from '../store/useStore';

export const useMining = (videoId: string, creatorId: string, isActive: boolean, videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const lastReportedTime = useRef(0);
  const reported80Percent = useRef(false);
  const { currentUser } = useStore();

  useEffect(() => {
    if (currentUser?.id) {
      miningService.init(currentUser.id);
    }
  }, [currentUser]);

  const reportActivity = useCallback(async (type: string, duration: number = 0, isCompletion80: boolean = false) => {
    try {
      await fetch('/api/payments/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          creatorId,
          type,
          duration,
          isCompletion80
        })
      });
      
      // Integrate with WhaTaka MiningTracker
      const tracker = miningService.getTracker();
      if (tracker) {
        if (type === 'view') {
          tracker.addRelayUnits(1);
        } else if (type === 'call') {
          tracker.addCallUnits(1);
        }
        // Periodically send report (e.g. every 5 units)
        // Or we can let it be manual/automatic in the service
      }

      console.log(`📊 Activity reported: ${type} (${duration}s, 80%:${isCompletion80})`);
    } catch (error) {
      console.error('Failed to report activity mining:', error);
    }
  }, [creatorId]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!isActive || !videoElement || !creatorId || creatorId === 'me') return;

    const interval = setInterval(() => {
      if (videoElement.paused) return;

      const currentTime = videoElement.currentTime;
      const duration = videoElement.duration;

      // 1. Every 10 seconds of playback
      if (currentTime - lastReportedTime.current >= 10) {
        reportActivity('view', 10);
        lastReportedTime.current = currentTime;
      }

      // 2. 80% completion
      if (!reported80Percent.current && duration > 0 && currentTime / duration >= 0.8) {
        reportActivity('view', 0, true);
        reported80Percent.current = true;
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      lastReportedTime.current = 0;
      reported80Percent.current = false;
    };
  }, [isActive, videoId, creatorId, videoRef, reportActivity]);

  return { reportActivity };
};
