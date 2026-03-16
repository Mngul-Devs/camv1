/**
 * useScheduler Hook
 * 
 * Manages interval scheduling for API Console requests.
 * Handles start/stop logic and next run time calculation.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { UseSchedulerReturn } from "../apiConsoleTypes";

export function useScheduler(): UseSchedulerReturn {
  const [scheduleMs, setScheduleMs] = useState<number>(30000); // 30 seconds default
  const [scheduleRunning, setScheduleRunning] = useState(false);
  const [nextRunAt, setNextRunAt] = useState<number | null>(null);

  const scheduleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleBusyRef = useRef(false);

  /**
   * Start the scheduler with a callback function
   * @param callback - Async function to call on each interval
   */
  const startScheduler = useCallback((callback: () => Promise<void>) => {
    // Stop any existing scheduler
    if (scheduleRef.current) {
      clearInterval(scheduleRef.current);
    }

    scheduleBusyRef.current = false;
    setScheduleRunning(true);
    setNextRunAt(Date.now() + scheduleMs);

    // Set up interval
    scheduleRef.current = setInterval(async () => {
      // Skip if already executing
      if (scheduleBusyRef.current) return;

      scheduleBusyRef.current = true;
      try {
        await callback();
      } catch (err) {
        console.error("Scheduler callback error:", err);
      } finally {
        scheduleBusyRef.current = false;
        setNextRunAt(Date.now() + scheduleMs);
      }
    }, scheduleMs);
  }, [scheduleMs]);

  /**
   * Stop the scheduler
   */
  const stopScheduler = useCallback(() => {
    if (scheduleRef.current) {
      clearInterval(scheduleRef.current);
      scheduleRef.current = null;
    }
    scheduleBusyRef.current = false;
    setScheduleRunning(false);
    setNextRunAt(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScheduler();
    };
  }, [stopScheduler]);

  return {
    scheduleMs,
    setScheduleMs,
    scheduleRunning,
    nextRunAt,
    startScheduler,
    stopScheduler,
  };
}
