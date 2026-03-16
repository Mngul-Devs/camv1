/**
 * useDestinationPresets Hook
 * 
 * Manages destination preset CRUD operations with localStorage persistence.
 */

import { useState, useEffect, useCallback } from "react";
import type { DestinationPreset, UseDestinationPresetsReturn } from "../apiConsoleTypes";
import { getFromStorage, saveToStorage } from "../apiConsoleUtils";

const PRESETS_STORAGE_KEY = "campark_api_console_destination_presets_v1";
const MAX_PRESETS = 30;

export function useDestinationPresets(): UseDestinationPresetsReturn {
  const [presets, setPresets] = useState<DestinationPreset[]>([]);

  // Load presets from localStorage on mount
  useEffect(() => {
    const loaded = getFromStorage<DestinationPreset[]>(PRESETS_STORAGE_KEY, []);
    if (Array.isArray(loaded)) {
      setPresets(loaded);
    }
  }, []);

  // Save presets to localStorage whenever they change
  useEffect(() => {
    saveToStorage(PRESETS_STORAGE_KEY, presets);
  }, [presets]);

  /**
   * Add a new preset
   * @param preset - Preset to add
   */
  const addPreset = useCallback((preset: DestinationPreset) => {
    setPresets((prev) => [preset, ...prev].slice(0, MAX_PRESETS));
  }, []);

  /**
   * Delete a preset by ID
   * @param id - Preset ID
   */
  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /**
   * Update a preset by ID
   * @param id - Preset ID
   * @param updates - Partial preset object with updates
   */
  const updatePreset = useCallback((id: string, updates: Partial<DestinationPreset>) => {
    setPresets((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  }, []);

  /**
   * Get a preset by ID
   * @param id - Preset ID
   * @returns Preset or undefined
   */
  const getPreset = useCallback(
    (id: string): DestinationPreset | undefined => {
      return presets.find((p) => p.id === id);
    },
    [presets],
  );

  return {
    presets,
    addPreset,
    deletePreset,
    updatePreset,
    getPreset,
  };
}
