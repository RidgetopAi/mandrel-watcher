/**
 * MandrelClient - HTTP client for Mandrel API
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

export class MandrelClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(baseUrl: string, authToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.authToken = authToken;
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

  /**
   * Get the currently active session
   */
  async getActiveSession(): Promise<ActiveSession | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/sessions/current`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('No active session found');
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success || !data.data?.session) {
        return null;
      }

      const session = data.data.session;
      return {
        session_id: session.id,
        project_id: session.project_id,
        project_name: session.project_name,
      };
    } catch (error) {
      logger.error('Failed to get active session:', error);
      return null;
    }
  }

  /**
   * Push git stats (commits + file changes) to Mandrel
   */
  async pushStats(payload: PushStatsPayload): Promise<boolean> {
    try {
      logger.debug(`Pushing ${payload.commits.length} commit(s) to Mandrel`);

      const response = await fetch(`${this.baseUrl}/api/git/push-stats`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const result = await response.json();
      
      if (result.success) {
        logger.info(`✓ Pushed ${payload.commits.length} commit(s): ${result.data?.commits_created || 0} new, ${result.data?.commits_skipped || 0} skipped`);
        return true;
      } else {
        logger.warn('Push returned success=false:', result.error);
        return false;
      }
    } catch (error) {
      logger.error('Failed to push stats:', error);
      return false;
    }
  }
}
