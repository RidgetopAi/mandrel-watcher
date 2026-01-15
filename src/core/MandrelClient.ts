/**
 * MandrelClient - HTTP client for Mandrel API with reconnection logic
 */

import { logger } from '../utils/logger';

export interface CommitFile {
  path: string;
  lines_added: number;
  lines_deleted: number;
  change_type: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface CommitData {
  sha: string;
  message: string;
  author_name: string;
  author_email: string;
  author_date: string;
  files: CommitFile[];
}

export interface PushStatsPayload {
  project_id?: string;
  project_name?: string;
  session_id?: string;
  commits: CommitData[];
}

export interface ActiveSession {
  session_id: string;
  project_id: string;
  project_name?: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

export type ConnectionState = 'connected' | 'disconnected' | 'connecting';

export class MandrelClient {
  private baseUrl: string;
  private authToken?: string;
  private retryConfig: RetryConfig;
  private connectionState: ConnectionState = 'disconnected';
  private lastSuccessfulRequest: Date | null = null;
  private consecutiveFailures: number = 0;

  constructor(baseUrl: string, authToken?: string, retryConfig?: Partial<RetryConfig>) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getLastSuccessfulRequest(): Date | null {
    return this.lastSuccessfulRequest;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  private calculateDelay(attempt: number): number {
    const delay = this.retryConfig.baseDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
    const jitter = Math.random() * 0.3 * delay; // Add up to 30% jitter
    return Math.min(delay + jitter, this.retryConfig.maxDelayMs);
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private markSuccess(): void {
    this.connectionState = 'connected';
    this.lastSuccessfulRequest = new Date();
    this.consecutiveFailures = 0;
  }

  private markFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      this.connectionState = 'disconnected';
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof TypeError) {
      // Network errors (fetch failures)
      return true;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on network/timeout errors
      if (message.includes('network') || 
          message.includes('timeout') ||
          message.includes('econnrefused') ||
          message.includes('enotfound') ||
          message.includes('socket')) {
        return true;
      }
      // Retry on 5xx errors
      if (message.includes('http 5')) {
        return true;
      }
    }
    return false;
  }

  private async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    operation: string
  ): Promise<{ success: boolean; data?: T; error?: string }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt - 1);
          logger.debug(`${operation}: Retry ${attempt}/${this.retryConfig.maxRetries} after ${Math.round(delay)}ms`);
          this.connectionState = 'connecting';
          await this.sleep(delay);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          const text = await response.text();
          const error = new Error(`HTTP ${response.status}: ${text}`);
          
          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            this.markSuccess(); // Connection worked, just bad request
            return { success: false, error: error.message };
          }
          
          throw error;
        }

        const data = await response.json() as T;
        this.markSuccess();
        return { success: true, data };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.markFailure();

        if (!this.isRetryableError(error) || attempt === this.retryConfig.maxRetries) {
          logger.error(`${operation} failed after ${attempt + 1} attempt(s):`, lastError.message);
          return { success: false, error: lastError.message };
        }

        logger.warn(`${operation} attempt ${attempt + 1} failed:`, lastError.message);
      }
    }

    return { success: false, error: lastError?.message || 'Unknown error' };
  }

  /**
   * Get the currently active session
   */
  async getActiveSession(): Promise<ActiveSession | null> {
    const result = await this.fetchWithRetry<{
      success: boolean;
      data?: { session?: { id: string; project_id: string; project_name?: string } };
    }>(
      `${this.baseUrl}/api/sessions/current`,
      { method: 'GET', headers: this.getHeaders() },
      'GetActiveSession'
    );

    if (!result.success || !result.data?.success || !result.data?.data?.session) {
      if (result.error?.includes('404')) {
        logger.debug('No active session found');
      }
      return null;
    }

    const session = result.data.data.session;
    return {
      session_id: session.id,
      project_id: session.project_id,
      project_name: session.project_name,
    };
  }

  /**
   * Push git stats (commits + file changes) to Mandrel
   */
  async pushStats(payload: PushStatsPayload): Promise<boolean> {
    logger.debug(`Pushing ${payload.commits.length} commit(s) to Mandrel`);

    const result = await this.fetchWithRetry<{
      success: boolean;
      data?: { commits_created?: number; commits_skipped?: number };
      error?: string;
    }>(
      `${this.baseUrl}/api/git/push-stats`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      },
      'PushStats'
    );

    if (result.success && result.data?.success) {
      logger.info(`✓ Pushed ${payload.commits.length} commit(s): ${result.data.data?.commits_created || 0} new, ${result.data.data?.commits_skipped || 0} skipped`);
      return true;
    }

    logger.warn('Push failed:', result.error || result.data?.error);
    return false;
  }

  /**
   * Health check - ping the API
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        this.markSuccess();
        return true;
      }
      this.markFailure();
      return false;
    } catch {
      this.markFailure();
      return false;
    }
  }
}
