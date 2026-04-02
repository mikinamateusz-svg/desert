import { Camera } from 'expo-camera';
import { useState, useEffect } from 'react';

export function useCameraPermission() {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  useEffect(() => {
    void Camera.getCameraPermissionsAsync().then(({ status }) => {
      setPermissionGranted(status === 'granted');
    });
  }, []);

  const requestPermission = async (): Promise<boolean> => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    const granted = status === 'granted';
    setPermissionGranted(granted);
    return granted;
  };

  return { permissionGranted, requestPermission };
}
