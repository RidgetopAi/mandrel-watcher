/**
 * RetryQueue - Persistent queue for failed API pushes
 * Stores failed payloads to disk and retries them when connection is restored
 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger';
import type { PushStatsPayload } from './MandrelClient';

export interface QueuedItem {
  id: string;
  payload: PushStatsPayload;
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  error?: string;
}

export interface QueueStats {
  pending: number;
  totalAttempts: number;
  oldestItem?: Date;
}

const QUEUE_DIR = join(homedir(), '.config', 'mandrel-watcher', 'queue');
const QUEUE_FILE = join(QUEUE_DIR, 'pending.json');
const MAX_QUEUE_SIZE = 100;
const MAX_ITEM_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class RetryQueue {
  private queue: QueuedItem[] = [];
  private processing: boolean = false;

  constructor() {
    this.ensureQueueDir();
    this.load();
  }

  private ensureQueueDir(): void {
    if (!existsSync(QUEUE_DIR)) {
      mkdirSync(QUEUE_DIR, { recursive: true });
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private load(): void {
    try {
      if (existsSync(QUEUE_FILE)) {
        const fs = require('node:fs');
        const text = fs.readFileSync(QUEUE_FILE, 'utf-8');
        this.queue = text.trim() ? JSON.parse(text) : [];
        this.cleanup();
        logger.debug(`Loaded ${this.queue.length} items from retry queue`);
      }
    } catch (error) {
      logger.warn('Failed to load retry queue, starting fresh:', error);
      this.queue = [];
    }
  }

  private async save(): Promise<void> {
    try {
      await Bun.write(QUEUE_FILE, JSON.stringify(this.queue, null, 2));
    } catch (error) {
      logger.error('Failed to save retry queue:', error);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const originalLength = this.queue.length;
    
    // Remove items older than MAX_ITEM_AGE_MS
    this.queue = this.queue.filter(item => {
      const age = now - new Date(item.createdAt).getTime();
      return age < MAX_ITEM_AGE_MS;
    });

    // Trim to MAX_QUEUE_SIZE (keep newest)
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
    }

    if (this.queue.length !== originalLength) {
      logger.debug(`Cleaned up ${originalLength - this.queue.length} old queue items`);
    }
  }

  async enqueue(payload: PushStatsPayload, error?: string): Promise<void> {
    const item: QueuedItem = {
      id: this.generateId(),
      payload,
      attempts: 1,
      createdAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      error,
    };

    this.queue.push(item);
    this.cleanup();
    await this.save();
    
    logger.info(`Queued ${payload.commits.length} commit(s) for retry (${this.queue.length} items in queue)`);
  }

  async markAttempt(id: string, error?: string): Promise<void> {
    const item = this.queue.find(i => i.id === id);
    if (item) {
      item.attempts++;
      item.lastAttemptAt = new Date().toISOString();
      item.error = error;
      await this.save();
    }
  }

  async remove(id: string): Promise<void> {
    this.queue = this.queue.filter(i => i.id !== id);
    await this.save();
  }

  async clear(): Promise<void> {
    this.queue = [];
    await this.save();
    logger.info('Retry queue cleared');
  }

  getItems(): QueuedItem[] {
    return [...this.queue];
  }

  getStats(): QueueStats {
    const stats: QueueStats = {
      pending: this.queue.length,
      totalAttempts: this.queue.reduce((sum, item) => sum + item.attempts, 0),
    };

    if (this.queue.length > 0) {
      stats.oldestItem = new Date(this.queue[0].createdAt);
    }

    return stats;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Process the queue with a push function
   * Returns number of successfully processed items
   */
  async processQueue(
    pushFn: (payload: PushStatsPayload) => Promise<boolean>
  ): Promise<number> {
    if (this.processing || this.queue.length === 0) {
      return 0;
    }

    this.processing = true;
    let successCount = 0;

    logger.info(`Processing retry queue (${this.queue.length} items)`);

    // Process oldest first
    const itemsToProcess = [...this.queue];
    
    for (const item of itemsToProcess) {
      try {
        const success = await pushFn(item.payload);
        
        if (success) {
          await this.remove(item.id);
          successCount++;
          logger.debug(`Queue item ${item.id} processed successfully`);
        } else {
          await this.markAttempt(item.id, 'Push returned false');
          // Stop processing on first failure - connection might be down
          break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.markAttempt(item.id, errorMsg);
        logger.warn(`Queue item ${item.id} failed (attempt ${item.attempts + 1}):`, errorMsg);
        // Stop processing on error
        break;
      }
    }

    this.processing = false;
    
    if (successCount > 0) {
      logger.info(`Processed ${successCount}/${itemsToProcess.length} queued items`);
    }

    return successCount;
  }
}
