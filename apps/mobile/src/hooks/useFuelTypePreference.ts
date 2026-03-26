import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import type { FuelType } from '@desert/types';

const STORAGE_KEY_FUEL     = '@litro/fuelType';
const STORAGE_KEY_PROMPTED = '@litro/fuelTypePromptSeen';
const DEFAULT_FUEL: FuelType = 'PB_95';
const VALID_FUEL_TYPES: readonly FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

export interface UseFuelTypePreferenceResult {
  fuelType: FuelType;
  setFuelType: (ft: FuelType) => void;
  hasSeenPrompt: boolean;
  markPromptSeen: () => void;
  /** false until AsyncStorage has been read — prevents flash-to-default on startup */
  loaded: boolean;
}

export function useFuelTypePreference(): UseFuelTypePreferenceResult {
  const [fuelType, setFuelTypeState] = useState<FuelType>(DEFAULT_FUEL);
  const [hasSeenPrompt, setHasSeenPrompt] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_FUEL),
      AsyncStorage.getItem(STORAGE_KEY_PROMPTED),
    ])
      .then(([storedFuel, storedPrompted]) => {
        if (storedFuel && (VALID_FUEL_TYPES as string[]).includes(storedFuel)) {
          setFuelTypeState(storedFuel as FuelType);
        }
        // Invalid/null stored value → silently keep DEFAULT_FUEL (AC6, AC7)
        if (storedPrompted === 'true') {
          setHasSeenPrompt(true);
        }
      })
      .catch(() => {
        // AsyncStorage failure → silent fallback to defaults (AC6)
      })
      .finally(() => setLoaded(true));
  }, []);

  const setFuelType = useCallback((ft: FuelType) => {
    setFuelTypeState(ft);
    void AsyncStorage.setItem(STORAGE_KEY_FUEL, ft).catch(() => { /* silent */ });
  }, []);

  const markPromptSeen = useCallback(() => {
    setHasSeenPrompt(true);
    void AsyncStorage.setItem(STORAGE_KEY_PROMPTED, 'true').catch(() => { /* silent */ });
  }, []);

  return { fuelType, setFuelType, hasSeenPrompt, markPromptSeen, loaded };
}
