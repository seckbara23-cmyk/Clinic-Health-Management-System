'use client'

import { useMemo } from 'react'
import { useClinicSettings } from '@/hooks/useClinicSettings'
import {
  settingBool, settingNumber, settingString, aiFeatureEnabled, type SettingsMap,
} from '@/lib/settings/consumer'

/**
 * Typed, fallback-safe access to the clinic's configuration (Administration Hub,
 * Phase 12) for consuming modules. Reuses the shared, cached clinic_settings
 * query (no duplicate request). Every getter takes a fallback = the module's
 * existing default, so nothing regresses when a setting is unset.
 */
export function useClinicConfig() {
  const { data, isLoading } = useClinicSettings()

  return useMemo(() => {
    const map = (data ?? {}) as SettingsMap
    return {
      ready: !isLoading,
      getBool: (section: string, key: string, fallback: boolean) => settingBool(map, section, key, fallback),
      getNumber: (section: string, key: string, fallback: number) => settingNumber(map, section, key, fallback),
      getString: (section: string, key: string, fallback: string) => settingString(map, section, key, fallback),
      /** AI feature gate — true unless the admin disabled AI or that feature. */
      ai: (feature: string) => aiFeatureEnabled(map, feature),
    }
  }, [data, isLoading])
}
