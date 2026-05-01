import { useCallback, useMemo, useRef } from 'react';

export const useNotificationSound = (soundEnabled: boolean) => {
  const notificationSoundUrl = useMemo(() => {
    try {
      return new URL('../lib/mixkit-long-pop-2358.wav', import.meta.url).href;
    } catch {
      return null;
    }
  }, []);
  const audioUrlRef = useRef<string | null>(notificationSoundUrl);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const suppressSoundOnConnectRef = useRef<boolean>(false);
  const suppressSoundReleaseTimerRef = useRef<number | null>(null);
  const connectSoundSuppressionTokenRef = useRef(0);

  const initPersistentAudio = useCallback(() => {
    try {
      if (audioElRef.current) {
        return;
      }

      const uri = audioUrlRef.current ?? notificationSoundUrl;
      if (!uri) {
        return;
      }

      audioUrlRef.current = uri;
      const audio = new Audio(uri);
      audio.preload = 'auto';
      audio.volume = 1;
      audio.loop = false;
      audioElRef.current = audio;
      void audio.play().catch(() => {});
    } catch {}
  }, [notificationSoundUrl]);

  const stopNotificationSound = useCallback(() => {
    try {
      if (audioUrlRef.current) {
        try {
          if (audioUrlRef.current.startsWith('blob:')) {
            URL.revokeObjectURL(audioUrlRef.current);
          }
        } catch {}
        audioUrlRef.current = null;
      }

      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.src = '';
        audioElRef.current = null;
      }
    } catch {}
  }, []);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) {
      return;
    }

    try {
      initPersistentAudio();
      const audio = audioElRef.current;
      if (!audio) {
        return;
      }

      try {
        audio.currentTime = 0;
      } catch {}

      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          try {
            setTimeout(() => {
              try {
                audioElRef.current?.play().catch(() => {});
              } catch {}
            }, 200);
          } catch {}
        });
      }
    } catch {}
  }, [initPersistentAudio, soundEnabled]);

  const beginConnectSoundSuppression = useCallback((fallbackMs = 9000): number => {
    const nextToken = connectSoundSuppressionTokenRef.current + 1;
    connectSoundSuppressionTokenRef.current = nextToken;
    suppressSoundOnConnectRef.current = true;

    if (suppressSoundReleaseTimerRef.current !== null) {
      window.clearTimeout(suppressSoundReleaseTimerRef.current);
    }

    suppressSoundReleaseTimerRef.current = window.setTimeout(() => {
      if (connectSoundSuppressionTokenRef.current === nextToken) {
        suppressSoundOnConnectRef.current = false;
      }
      suppressSoundReleaseTimerRef.current = null;
    }, fallbackMs);

    return nextToken;
  }, []);

  const endConnectSoundSuppression = useCallback((token?: number) => {
    if (typeof token === 'number' && token !== connectSoundSuppressionTokenRef.current) {
      return;
    }

    suppressSoundOnConnectRef.current = false;
    if (suppressSoundReleaseTimerRef.current !== null) {
      window.clearTimeout(suppressSoundReleaseTimerRef.current);
      suppressSoundReleaseTimerRef.current = null;
    }
  }, []);

  const isConnectSoundSuppressed = useCallback(() => suppressSoundOnConnectRef.current, []);

  return {
    beginConnectSoundSuppression,
    endConnectSoundSuppression,
    initPersistentAudio,
    isConnectSoundSuppressed,
    playNotificationSound,
    stopNotificationSound
  };
};
