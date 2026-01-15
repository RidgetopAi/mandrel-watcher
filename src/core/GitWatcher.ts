/**
 * GitWatcher - Watch git repositories for commits
 */

import chokidar, { type FSWatcher } from 'chokidar';
import simpleGit, { type SimpleGit } from 'simple-git';
import { join } from 'path';
import { logger } from '../utils/logger';
import { debounce } from '../utils/debounce';
import type { CommitData, CommitFile } from './MandrelClient';

export interface GitWatcherOptions {
  projectPath: string;
  mandrelProject: string;
  debounceMs?: number;
  onCommit: (commits: CommitData[], projectPath: string, mandrelProject: string) => void;
}

export class GitWatcher {
  private projectPath: string;
  private mandrelProject: string;
  private git: SimpleGit;
  private watcher: FSWatcher | null = null;
  private lastCommitSha: string | null = null;
  private onCommit: GitWatcherOptions['onCommit'];
  private debouncedHandleChange: () => void;

  constructor(options: GitWatcherOptions) {
    this.projectPath = options.projectPath;
    this.mandrelProject = options.mandrelProject;
    this.git = simpleGit(options.projectPath);
    this.onCommit = options.onCommit;

    // Debounce the change handler to batch rapid git events
    this.debouncedHandleChange = debounce(
      () => this.handleGitChange(),
      options.debounceMs || 2000
    );
  }

  async start(): Promise<void> {
    logger.info(`Starting git watcher for ${this.projectPath}`);

    // Get the current HEAD commit to track from
    try {
      const log = await this.git.log({ maxCount: 1 });
      this.lastCommitSha = log.latest?.hash || null;
      logger.debug(`Starting from commit: ${this.lastCommitSha?.substring(0, 8) || 'none'}`);
    } catch (error) {
      logger.warn(`Could not get initial commit for ${this.projectPath}:`, error);
    }

    // Watch .git/logs/HEAD - this file is updated on every commit
    const gitLogsPath = join(this.projectPath, '.git', 'logs', 'HEAD');
    
    this.watcher = chokidar.watch(gitLogsPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', () => {
      logger.debug(`Git activity detected in ${this.projectPath}`);
      this.debouncedHandleChange();
    });

    this.watcher.on('error', (error) => {
      logger.error(`Watcher error for ${this.projectPath}:`, error);
    });

    logger.info(`✓ Watching ${this.projectPath} for commits`);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info(`Stopped watching ${this.projectPath}`);
    }
  }

  private async handleGitChange(): Promise<void> {
    try {
      // Get new commits since last known commit
      const commits = await this.getNewCommits();

      if (commits.length === 0) {
        logger.debug('No new commits found');
        return;
      }

      logger.info(`Found ${commits.length} new commit(s) in ${this.mandrelProject}`);

      // Update last known commit
      this.lastCommitSha = commits[0].sha;

      // Notify callback
      this.onCommit(commits, this.projectPath, this.mandrelProject);
    } catch (error) {
      logger.error('Error handling git change:', error);
    }
  }

  private async getNewCommits(): Promise<CommitData[]> {
    const commits: CommitData[] = [];

    try {
      // Get commits since last known, or last 5 if no baseline
      const logOptions = this.lastCommitSha
        ? { from: this.lastCommitSha, to: 'HEAD' }
        : { maxCount: 5 };

      const log = await this.git.log(logOptions);

      for (const commit of log.all) {
        // Skip if this is the baseline commit
        if (commit.hash === this.lastCommitSha) continue;

        const files = await this.getCommitFiles(commit.hash);

        commits.push({
          sha: commit.hash,
          message: commit.message,
          author_name: commit.author_name,
          author_email: commit.author_email,
          author_date: commit.date,
          files,
        });
      }
    } catch (error) {
      logger.error('Failed to get commits:', error);
    }

    // Return in chronological order (oldest first)
    return commits.reverse();
  }

  private async getCommitFiles(sha: string): Promise<CommitFile[]> {
    const files: CommitFile[] = [];

    try {
      // Get diff stats for the commit
      const diff = await this.git.diffSummary([`${sha}^`, sha]);

      for (const file of diff.files) {
        // Determine change type
        let changeType: CommitFile['change_type'] = 'modified';
        
        if ('insertions' in file) {
          // TypeScript type narrowing for diff files
          const insertions = (file as any).insertions || 0;
          const deletions = (file as any).deletions || 0;
          
          if (insertions > 0 && deletions === 0) {
            changeType = 'added';
          } else if (deletions > 0 && insertions === 0) {
            changeType = 'deleted';
          }
        }

        files.push({
          path: file.file,
          lines_added: (file as any).insertions || 0,
          lines_deleted: (file as any).deletions || 0,
          change_type: changeType,
        });
      }
    } catch (error) {
      // This can fail for initial commits or merge commits
      logger.debug(`Could not get diff for ${sha}:`, error);
    }

    return files;
  }
}
