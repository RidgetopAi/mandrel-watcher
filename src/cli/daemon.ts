/**
 * Daemon management - PID file, process control
 */

import { homedir } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

const PID_DIR = join(homedir(), '.config', 'mandrel-watcher');
const PID_FILE = join(PID_DIR, 'mandrel-watcher.pid');
const LOG_FILE = join(PID_DIR, 'mandrel-watcher.log');

export class DaemonManager {
  /**
   * Check if the daemon is already running
   */
  static async isRunning(): Promise<{ running: boolean; pid?: number }> {
    try {
      const file = Bun.file(PID_FILE);
      const exists = await file.exists();

      if (!exists) {
        return { running: false };
      }

      const pidStr = await file.text();
      const pid = parseInt(pidStr.trim(), 10);

      if (isNaN(pid)) {
        return { running: false };
      }

      // Check if process is actually running
      try {
        process.kill(pid, 0); // Signal 0 just checks if process exists
        return { running: true, pid };
      } catch {
        // Process not running, clean up stale PID file
        await Bun.$`rm -f ${PID_FILE}`.quiet();
        return { running: false };
      }
    } catch {
      return { running: false };
    }
  }

  /**
   * Write the current PID to the PID file
   */
  static async writePid(): Promise<void> {
    await Bun.$`mkdir -p ${PID_DIR}`.quiet();
    await Bun.write(PID_FILE, String(process.pid));
    logger.debug(`Wrote PID ${process.pid} to ${PID_FILE}`);
  }

  /**
   * Remove the PID file
   */
  static async removePid(): Promise<void> {
    try {
      await Bun.$`rm -f ${PID_FILE}`.quiet();
    } catch {
      // Ignore errors
    }
  }

  /**
   * Stop the running daemon
   */
  static async stop(): Promise<boolean> {
    const { running, pid } = await this.isRunning();

    if (!running || !pid) {
      logger.info('Daemon is not running');
      return false;
    }

    logger.info(`Stopping daemon (PID ${pid})...`);

    try {
      process.kill(pid, 'SIGTERM');
      
      // Wait for process to exit (up to 5 seconds)
      for (let i = 0; i < 50; i++) {
        await Bun.sleep(100);
        try {
          process.kill(pid, 0);
        } catch {
          // Process has exited
          await this.removePid();
          logger.info('Daemon stopped');
          return true;
        }
      }

      // Force kill if still running
      logger.warn('Daemon did not stop gracefully, sending SIGKILL');
      process.kill(pid, 'SIGKILL');
      await this.removePid();
      return true;
    } catch (error) {
      logger.error('Failed to stop daemon:', error);
      return false;
    }
  }

  /**
   * Get paths for daemon files
   */
  static getPaths() {
    return {
      pidFile: PID_FILE,
      logFile: LOG_FILE,
      configDir: PID_DIR,
    };
  }
}
