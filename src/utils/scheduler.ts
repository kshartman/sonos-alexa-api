/**
 * Lightweight scheduler abstraction that can be disabled in unit test environments
 * Prevents persistent timers from keeping Node.js processes alive during testing
 */

interface ScheduledTask {
  id: string;
  timer: NodeJS.Timeout;
  interval: number;
  callback: () => void | Promise<void>;
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
      console.log(`[SCHEDULER] Skipping interval task '${id}' - scheduler disabled`);
      return;
    }

    // Clear existing task if it exists
    this.clearTask(id);

    const timer = setInterval(async () => {
      try {
        await callback();
      } catch (error) {
        console.error(`[SCHEDULER] Error in task '${id}':`, error);
      }
    }, intervalMs);

    // Unref to prevent blocking process exit
    if (options.unref !== false) {
      timer.unref();
    }

    this.tasks.set(id, {
      id,
      timer,
      interval: intervalMs,
      callback
    });

    console.log(`[SCHEDULER] Scheduled interval task '${id}' every ${intervalMs}ms`);
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
      console.log(`[SCHEDULER] Skipping timeout task '${id}' - scheduler disabled`);
      return;
    }

    // Clear existing task if it exists
    this.clearTask(id);

    const timer = setTimeout(async () => {
      try {
        await callback();
        // Remove from tasks map since it's a one-time task
        this.tasks.delete(id);
      } catch (error) {
        console.error(`[SCHEDULER] Error in task '${id}':`, error);
        this.tasks.delete(id);
      }
    }, delayMs);

    // Unref to prevent blocking process exit
    if (options.unref !== false) {
      timer.unref();
    }

    this.tasks.set(id, {
      id,
      timer,
      interval: delayMs,
      callback
    });

    console.log(`[SCHEDULER] Scheduled timeout task '${id}' in ${delayMs}ms`);
  }

  /**
   * Clear a specific scheduled task
   */
  clearTask(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      clearTimeout(task.timer); // Works for both setTimeout and setInterval
      this.tasks.delete(id);
      console.log(`[SCHEDULER] Cleared task '${id}'`);
    }
  }

  /**
   * Clear all scheduled tasks
   */
  clearAll(): void {
    for (const [id, task] of this.tasks) {
      clearTimeout(task.timer);
      console.log(`[SCHEDULER] Cleared task '${id}'`);
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