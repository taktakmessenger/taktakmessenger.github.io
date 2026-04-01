import React, { useRef, useEffect } from 'react';

interface VideoPlayerProps {
  src: string;
}

export default function VideoPlayer({ src }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    const onVis = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          v.play().catch(() => {});
        } else {
          v.pause();
        }
      });
    };

    const obs = new IntersectionObserver(onVis, { threshold: 0.6 });
    obs.observe(v);
    
    return () => obs.disconnect();
  }, []);

  return (
    <div style={{ width: '100%', position: 'relative', paddingTop: '177.77%', backgroundColor: '#000' }}>
      <video
        ref={ref}
        src={src}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted
        playsInline
        controls
        preload="metadata"
        loop
      />
    </div>
  );
}
