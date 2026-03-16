/**
 * useSiteRouting Hook
 * 
 * Manages site-based routing configuration with localStorage persistence.
 */

import { useState, useEffect, useCallback } from "react";
import type { SiteRouteRule, DestinationPreset, UseSiteRoutingReturn } from "../apiConsoleTypes";
import { getFromStorage, saveToStorage, resolveRouteTargetUrl } from "../apiConsoleUtils";

const SITE_ROUTES_STORAGE_KEY = "campark_api_console_site_routes_v1";

export function useSiteRouting(): UseSiteRoutingReturn {
  const [siteRoutes, setSiteRoutes] = useState<SiteRouteRule[]>([]);

  // Load routes from localStorage on mount
  useEffect(() => {
    const loaded = getFromStorage<SiteRouteRule[]>(SITE_ROUTES_STORAGE_KEY, []);
    if (Array.isArray(loaded)) {
      setSiteRoutes(loaded);
    }
  }, []);

  // Save routes to localStorage whenever they change
  useEffect(() => {
    saveToStorage(SITE_ROUTES_STORAGE_KEY, siteRoutes);
  }, [siteRoutes]);

  /**
   * Add a new site route
   * @param rule - Route rule to add
   */
  const addRoute = useCallback((rule: SiteRouteRule) => {
    setSiteRoutes((prev) => {
      // Replace existing route for same site
      const withoutSite = prev.filter((r) => r.siteId !== rule.siteId);
      return [...withoutSite, rule];
    });
  }, []);

  /**
   * Delete a route by ID
   * @param id - Route ID
   */
  const deleteRoute = useCallback((id: string) => {
    setSiteRoutes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /**
   * Update a route by ID
   * @param id - Route ID
   * @param updates - Partial route object with updates
   */
  const updateRoute = useCallback((id: string, updates: Partial<SiteRouteRule>) => {
    setSiteRoutes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    );
  }, []);

  /**
   * Get a route by site ID
   * @param siteId - Site ID
   * @returns Route or undefined
   */
  const getRoute = useCallback(
    (siteId: number): SiteRouteRule | undefined => {
      return siteRoutes.find((r) => r.siteId === siteId);
    },
    [siteRoutes],
  );

  /**
   * Resolve the target URL for a route
   * @param rule - Route rule
   * @param presets - Available destination presets
   * @returns Resolved URL string
   */
  const resolveUrl = useCallback(
    (rule: SiteRouteRule, presets: DestinationPreset[]): string => {
      return resolveRouteTargetUrl(rule, presets);
    },
    [],
  );

  return {
    siteRoutes,
    addRoute,
    deleteRoute,
    updateRoute,
    getRoute,
    resolveRouteUrl: resolveUrl,
  };
}
