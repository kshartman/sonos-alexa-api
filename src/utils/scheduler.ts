/**
 * Lightweight scheduler abstraction that can be disabled in unit test environments
 * Prevents persistent timers from keeping Node.js processes alive during testing
 */

import logger from './logger.js';

interface ScheduledTask {
  id: string;
  timer: NodeJS.Timeout;
  interval: number;
  callback: () => void | Promise<void>;
  type: 'interval' | 'timeout';
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
}

class Scheduler {
  private tasks = new Map<string, ScheduledTask>();
  private enabled: boolean;

  constructor() {
    // Disable scheduler in unit test environments
    this.enabled = !(
      process.env.NO_SCHEDULER === 'true' ||
      process.env.LOG_LEVEL === 'silent' ||
      process.env.NODE_ENV === 'test'
    );
  }

  /**
   * Schedule a recurring task (like setInterval)
   * @param id - Unique identifier for the task
   * @param callback - Function to execute
   * @param intervalMs - Interval in milliseconds
   * @param options - Additional options
   */
  scheduleInterval(
    id: string, 
    callback: () => void | Promise<void>, 
    intervalMs: number,
    options: { unref?: boolean } = {}
  ): void {
    if (!this.enabled) {
      logger.debug(`[SCHEDULER] Skipping interval task '${id}' - scheduler disabled`);
      return;
    }

    // Clear existing task if it exists
    this.clearTask(id);

    const task: ScheduledTask = {
      id,
      timer: null as any, // Will be set below
      interval: intervalMs,
      callback,
      type: 'interval',
      createdAt: new Date(),
      nextRun: new Date(Date.now() + intervalMs),
      runCount: 0
    };

    const timer = setInterval(async () => {
      try {
        task.lastRun = new Date();
        task.runCount++;
        task.nextRun = new Date(Date.now() + intervalMs);
        await callback();
      } catch (error) {
        logger.error(`[SCHEDULER] Error in task '${id}':`, error);
      }
    }, intervalMs);

    task.timer = timer;

    // Unref to prevent blocking process exit
    if (options.unref !== false) {
      timer.unref();
    }

    this.tasks.set(id, task);

    logger.debug(`[SCHEDULER] Scheduled interval task '${id}' every ${intervalMs}ms`);
  }

  /**
   * Schedule a one-time delayed task (like setTimeout)
   * @param id - Unique identifier for the task
   * @param callback - Function to execute
   * @param delayMs - Delay in milliseconds
   * @param options - Additional options
   */
  scheduleTimeout(
    id: string,
    callback: () => void | Promise<void>,
    delayMs: number,
    options: { unref?: boolean } = {}
  ): void {
    if (!this.enabled) {
      logger.debug(`[SCHEDULER] Skipping timeout task '${id}' - scheduler disabled`);
      return;
    }

    // Clear existing task if it exists
    this.clearTask(id);

    const task: ScheduledTask = {
      id,
      timer: null as any, // Will be set below
      interval: delayMs,
      callback,
      type: 'timeout',
      createdAt: new Date(),
      nextRun: new Date(Date.now() + delayMs),
      runCount: 0
    };

    const timer = setTimeout(async () => {
      try {
        task.lastRun = new Date();
        task.runCount++;
        task.nextRun = undefined; // No next run for timeout
        await callback();
        // Remove from tasks map since it's a one-time task
        this.tasks.delete(id);
      } catch (error) {
        logger.error(`[SCHEDULER] Error in task '${id}':`, error);
        this.tasks.delete(id);
      }
    }, delayMs);

    task.timer = timer;

    // Unref to prevent blocking process exit
    if (options.unref !== false) {
      timer.unref();
    }

    this.tasks.set(id, task);

    logger.debug(`[SCHEDULER] Scheduled timeout task '${id}' in ${delayMs}ms`);
  }

  /**
   * Clear a specific scheduled task
   */
  clearTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      clearTimeout(task.timer); // Works for both setTimeout and setInterval
      this.tasks.delete(id);
      logger.trace(`[SCHEDULER] Cleared task '${id}'`);
    }
  }

  /**
   * Clear all scheduled tasks
   */
  clearAll(): void {
    for (const [id, task] of this.tasks) {
      clearTimeout(task.timer);
      logger.trace(`[SCHEDULER] Cleared task '${id}'`);
    }
    this.tasks.clear();
  }

  /**
   * Get status of all tasks
   */
  getStatus(): { enabled: boolean; taskCount: number; tasks: string[] } {
    return {
      enabled: this.enabled,
      taskCount: this.tasks.size,
      tasks: Array.from(this.tasks.keys())
    };
  }

  /**
   * Check if scheduler is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get detailed information about all tasks
   */
  getDetailedTasks(): Record<string, {
    type: 'interval' | 'timeout';
    interval: string;
    createdAt: string;
    lastRun?: string;
    nextRun?: string;
    runCount: number;
    status: 'pending' | 'running' | 'completed';
  }> {
    const tasks: Record<string, any> = {};
    
    for (const [id, task] of this.tasks) {
      let status: 'pending' | 'running' | 'completed' = 'pending';
      
      if (task.type === 'timeout' && task.lastRun) {
        status = 'completed';
      } else if (task.lastRun) {
        status = 'running';
      }
      
      tasks[id] = {
        type: task.type,
        interval: this.formatDuration(task.interval),
        createdAt: task.createdAt.toLocaleString(),
        lastRun: task.lastRun ? task.lastRun.toLocaleString() : undefined,
        nextRun: task.nextRun ? task.nextRun.toLocaleString() : undefined,
        runCount: task.runCount,
        status
      };
    }
    
    return tasks;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }
}

// Global scheduler instance
export const scheduler = new Scheduler();

// Cleanup on process exit
process.on('exit', () => {
  scheduler.clearAll();
});

process.on('SIGINT', () => {
  scheduler.clearAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  scheduler.clearAll();
  process.exit(0);
});