/**
 * CLI Commands - start, stop, status, config
 */

import { DaemonManager } from './daemon';
import { configManager } from '../core/ConfigManager';
import { GitWatcher } from '../core/GitWatcher';
import { MandrelClient, type CommitData, type PushStatsPayload } from '../core/MandrelClient';
import { RetryQueue } from '../core/RetryQueue';
import { logger } from '../utils/logger';

// Active watchers for cleanup
let activeWatchers: Map<string, GitWatcher> = new Map(); // keyed by project path
let isShuttingDown = false;
let retryQueue: RetryQueue;
let mandrelClient: MandrelClient;

// Retry queue processing interval (60 seconds)
const RETRY_INTERVAL_MS = 60000;
let retryIntervalId: ReturnType<typeof setInterval> | null = null;

// Project refresh interval (from config, default 5 minutes)
let projectRefreshIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start command - begin watching configured projects
 */
export async function startCommand(options: { foreground?: boolean; debug?: boolean }): Promise<void> {
  if (options.debug) {
    logger.setLevel('debug');
  }

  // Check if already running
  const { running, pid } = await DaemonManager.isRunning();
  if (running) {
    logger.error(`Daemon is already running (PID ${pid})`);
    process.exit(1);
  }

  // Load configuration
  const config = await configManager.load();

  if (config.projects.length === 0) {
    logger.warn('No projects found. Configure root_directory in Mandrel project settings.');
    logger.info('Watcher will check for new projects periodically.');
  }

  // Write PID file
  await DaemonManager.writePid();

  // Initialize retry queue and Mandrel client
  retryQueue = new RetryQueue();
  mandrelClient = new MandrelClient(
    config.api_url, 
    config.auth_token,
    undefined, // default retry config
    { refreshIntervalMs: (config.session_poll_interval || 30) * 1000 }
  );

  // Setup signal handlers for graceful shutdown
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutting down...');

    // Stop retry interval
    if (retryIntervalId) {
      clearInterval(retryIntervalId);
    }

    // Stop project refresh interval
    if (projectRefreshIntervalId) {
      clearInterval(projectRefreshIntervalId);
    }

    for (const watcher of activeWatchers.values()) {
      await watcher.stop();
    }

    await DaemonManager.removePid();

    const queueStats = retryQueue.getStats();
    if (queueStats.pending > 0) {
      logger.info(`${queueStats.pending} items remain in retry queue (will resume on restart)`);
    }

    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Push function with queue fallback
  const pushWithRetry = async (payload: PushStatsPayload): Promise<void> => {
    const success = await mandrelClient.pushStats(payload);
    
    if (!success) {
      // Queue for retry
      await retryQueue.enqueue(payload, 'Initial push failed');
    }
  };

  // Commit handler - called when new commits are detected
  const handleCommits = async (commits: CommitData[], projectPath: string, mandrelProject: string) => {
    // Get session for this specific project (uses cache)
    const session = await mandrelClient.getSessionForProject(mandrelProject);

    await pushWithRetry({
      project_name: mandrelProject,
      session_id: session?.session_id,
      project_id: session?.project_id,
      commits,
    });
  };

  // Start retry queue processing
  const processRetryQueue = async () => {
    if (retryQueue.isEmpty()) return;
    
    const state = mandrelClient.getConnectionState();
    if (state === 'disconnected') {
      // Do a health check first
      const healthy = await mandrelClient.healthCheck();
      if (!healthy) {
        logger.debug('API still unavailable, skipping queue processing');
        return;
      }
    }
    
    await retryQueue.processQueue((payload) => mandrelClient.pushStats(payload));
  };

  // Helper to start watching a project
  const startWatcher = async (project: { path: string; mandrel_project: string }) => {
    // Skip if already watching
    if (activeWatchers.has(project.path)) {
      return false;
    }

    const watcher = new GitWatcher({
      projectPath: project.path,
      mandrelProject: project.mandrel_project,
      debounceMs: config.debounce_ms,
      onCommit: handleCommits,
    });

    try {
      await watcher.start();
      activeWatchers.set(project.path, watcher);
      return true;
    } catch (error) {
      logger.error(`Failed to start watcher for ${project.path}:`, error);
      return false;
    }
  };

  // Start watchers for each project
  logger.info(`Starting mandrel-watcher (PID ${process.pid})`);

  for (const project of config.projects) {
    await startWatcher(project);
  }

  // Refresh projects periodically to pick up new ones
  const refreshProjects = async () => {
    try {
      const oldProjects = new Set(config.projects.map(p => p.path));
      await configManager.fetchProjects();
      const newConfig = configManager.get();

      // Start watchers for any new projects
      let added = 0;
      for (const project of newConfig.projects) {
        if (!oldProjects.has(project.path)) {
          const started = await startWatcher(project);
          if (started) {
            added++;
            logger.info(`Added new project: ${project.mandrel_project}`);
          }
        }
      }

      // Stop watchers for removed projects
      const currentPaths = new Set(newConfig.projects.map(p => p.path));
      for (const [path, watcher] of activeWatchers) {
        if (!currentPaths.has(path)) {
          await watcher.stop();
          activeWatchers.delete(path);
          logger.info(`Removed project: ${path}`);
        }
      }

      if (added > 0) {
        logger.info(`Now watching ${activeWatchers.size} project(s)`);
      }
    } catch (error) {
      logger.warn('Failed to refresh projects:', error);
    }
  };

  // Process any queued items from previous runs
  await processRetryQueue();

  // Start periodic retry processing
  retryIntervalId = setInterval(processRetryQueue, RETRY_INTERVAL_MS);

  // Start periodic project refresh
  const refreshIntervalMs = (config.project_refresh_interval || 300) * 1000;
  projectRefreshIntervalId = setInterval(refreshProjects, refreshIntervalMs);

  const queueStats = retryQueue.getStats();
  logger.info(`Watching ${activeWatchers.size} project(s)${queueStats.pending > 0 ? ` (${queueStats.pending} items in retry queue)` : ''}. Press Ctrl+C to stop.`);
  logger.info(`Projects will be refreshed every ${config.project_refresh_interval || 300} seconds`);

  // Keep process alive
  if (!options.foreground) {
    // In background mode, just keep running
    await new Promise(() => {}); // Never resolves
  }
}

/**
 * Stop command - stop the running daemon
 */
export async function stopCommand(): Promise<void> {
  const stopped = await DaemonManager.stop();
  if (!stopped) {
    process.exit(1);
  }
}

/**
 * Status command - show current daemon status
 */
export async function statusCommand(): Promise<void> {
  const { running, pid } = await DaemonManager.isRunning();
  const paths = DaemonManager.getPaths();

  console.log('\n📊 Mandrel Watcher Status\n');
  
  if (running) {
    console.log(`  Status: 🟢 Running (PID ${pid})`);
  } else {
    console.log('  Status: 🔴 Stopped');
  }

  console.log(`  Config: ${configManager.getConfigPath()}`);
  console.log(`  PID File: ${paths.pidFile}`);

  // Load and show config
  try {
    const config = await configManager.load();
    console.log(`\n  API URL: ${config.api_url}`);
    console.log(`  Projects: ${config.projects.length} (from Mandrel API)`);
    console.log(`  Refresh interval: ${config.project_refresh_interval || 300}s`);

    for (const project of config.projects) {
      console.log(`    - ${project.mandrel_project}: ${project.path}`);
    }
  } catch {
    console.log('\n  ⚠️  Could not load config');
  }

  // Show retry queue status
  const queue = new RetryQueue();
  const queueStats = queue.getStats();
  
  console.log('\n  📤 Retry Queue:');
  if (queueStats.pending === 0) {
    console.log('    Empty (no pending items)');
  } else {
    console.log(`    Pending: ${queueStats.pending} items`);
    console.log(`    Total attempts: ${queueStats.totalAttempts}`);
    if (queueStats.oldestItem) {
      const age = Math.round((Date.now() - queueStats.oldestItem.getTime()) / 1000 / 60);
      console.log(`    Oldest item: ${age} minutes ago`);
    }
  }

  console.log('');
}

/**
 * Config init command - create default config file
 */
export async function configInitCommand(): Promise<void> {
  const configPath = configManager.getConfigPath();
  const file = Bun.file(configPath);
  const exists = await file.exists();

  if (exists) {
    logger.warn(`Config file already exists: ${configPath}`);
    logger.info('Edit it manually or delete it first.');
    return;
  }

  await configManager.createDefault();
  logger.info(`\nEdit the config file to add your projects:`);
  logger.info(`  ${configPath}`);
}

/**
 * Health command - check API connectivity and watcher health
 */
export async function healthCommand(): Promise<void> {
  console.log('\n🏥 Health Check\n');
  
  // Load config
  let config;
  try {
    config = await configManager.load();
    console.log('  ✅ Config loaded');
  } catch (error) {
    console.log('  ❌ Config error:', error);
    return;
  }
  
  // Check API connectivity
  const client = new MandrelClient(config.api_url, config.auth_token);
  
  console.log(`  Checking API: ${config.api_url}`);
  const healthy = await client.healthCheck();
  
  if (healthy) {
    console.log('  ✅ API reachable');
    console.log(`  Connection: ${client.getConnectionState()}`);
  } else {
    console.log('  ❌ API unreachable');
    console.log(`  Connection: ${client.getConnectionState()}`);
    console.log(`  Consecutive failures: ${client.getConsecutiveFailures()}`);
  }
  
  // Check active session
  console.log('\n  Checking active session...');
  const session = await client.getActiveSession();
  
  if (session) {
    console.log(`  ✅ Active session: ${session.session_id.substring(0, 8)}...`);
    console.log(`    Project: ${session.project_name || session.project_id}`);
  } else {
    console.log('  ⚠️  No active session (commits will be queued without session link)');
  }
  
  // Queue status
  const queue = new RetryQueue();
  const stats = queue.getStats();
  
  console.log('\n  📤 Queue:', stats.pending === 0 ? 'Empty' : `${stats.pending} pending`);
  
  // Daemon status
  const { running, pid } = await DaemonManager.isRunning();
  console.log('  🔄 Daemon:', running ? `Running (PID ${pid})` : 'Stopped');
  
  console.log('');
}

/**
 * Queue command - manage retry queue
 */
export async function queueCommand(action: 'list' | 'clear' | 'retry'): Promise<void> {
  const queue = new RetryQueue();
  
  switch (action) {
    case 'list': {
      const items = queue.getItems();
      const stats = queue.getStats();
      
      console.log('\n📤 Retry Queue\n');
      
      if (items.length === 0) {
        console.log('  Queue is empty\n');
        return;
      }
      
      console.log(`  Total: ${stats.pending} items, ${stats.totalAttempts} attempts\n`);
      
      for (const item of items) {
        const commits = item.payload.commits.length;
        const age = Math.round((Date.now() - new Date(item.createdAt).getTime()) / 1000 / 60);
        console.log(`  [${item.id}]`);
        console.log(`    Commits: ${commits}, Attempts: ${item.attempts}, Age: ${age}m`);
        if (item.error) {
          console.log(`    Error: ${item.error}`);
        }
      }
      console.log('');
      break;
    }
    
    case 'clear': {
      await queue.clear();
      console.log('Retry queue cleared');
      break;
    }
    
    case 'retry': {
      const config = await configManager.load();
      const client = new MandrelClient(config.api_url, config.auth_token);
      
      console.log('Processing retry queue...');
      const processed = await queue.processQueue((payload) => client.pushStats(payload));
      console.log(`Processed ${processed} items`);
      break;
    }
  }
}
