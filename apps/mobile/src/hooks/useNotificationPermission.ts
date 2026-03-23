import { useState, useEffect, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export type PermissionStatus = 'undetermined' | 'granted' | 'denied';

export function useNotificationPermission() {
  const [status, setStatus] = useState<PermissionStatus>('undetermined');
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { status: current } = await Notifications.getPermissionsAsync();
        if (current === 'granted') setStatus('granted');
        else if (current === 'denied') setStatus('denied');
        else setStatus('undetermined');
      } finally {
        setIsChecking(false);
      }
    })();
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    try {
      const { status: result } = await Notifications.requestPermissionsAsync();
      const mapped: PermissionStatus =
        result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'undetermined';
      setStatus(mapped);
      return mapped;
    } catch {
      return 'undetermined';
    }
  }, []);

  const getExpoPushToken = useCallback(async (): Promise<string | null> => {
    if (Platform.OS === 'web') return null;
    try {
      const { default: Constants } = await import('expo-constants');
      const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
      if (!projectId) return null;
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      return token.data;
    } catch {
      return null;
    }
  }, []);

  return { status, isChecking, requestPermission, getExpoPushToken };
}
