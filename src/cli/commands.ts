/**
 * CLI Commands - start, stop, status, config
 */

import { DaemonManager } from './daemon';
import { configManager } from '../core/ConfigManager';
import { GitWatcher } from '../core/GitWatcher';
import { MandrelClient, type CommitData } from '../core/MandrelClient';
import { logger } from '../utils/logger';

// Active watchers for cleanup
let activeWatchers: GitWatcher[] = [];
let isShuttingDown = false;

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
    logger.error('No projects configured. Edit config file:');
    logger.error(`  ${configManager.getConfigPath()}`);
    process.exit(1);
  }

  // Write PID file
  await DaemonManager.writePid();

  // Create Mandrel client
  const client = new MandrelClient(config.api_url, config.auth_token);

  // Setup signal handlers for graceful shutdown
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Shutting down...');
    
    for (const watcher of activeWatchers) {
      await watcher.stop();
    }
    
    await DaemonManager.removePid();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Commit handler - called when new commits are detected
  const handleCommits = async (commits: CommitData[], projectPath: string, mandrelProject: string) => {
    // Try to get active session
    const session = await client.getActiveSession();

    await client.pushStats({
      project_name: mandrelProject,
      session_id: session?.session_id,
      project_id: session?.project_id,
      commits,
    });
  };

  // Start watchers for each project
  logger.info(`Starting mandrel-watcher (PID ${process.pid})`);
  
  for (const project of config.projects) {
    const watcher = new GitWatcher({
      projectPath: project.path,
      mandrelProject: project.mandrel_project,
      debounceMs: config.debounce_ms,
      onCommit: handleCommits,
    });

    try {
      await watcher.start();
      activeWatchers.push(watcher);
    } catch (error) {
      logger.error(`Failed to start watcher for ${project.path}:`, error);
    }
  }

  if (activeWatchers.length === 0) {
    logger.error('No watchers started. Exiting.');
    await DaemonManager.removePid();
    process.exit(1);
  }

  logger.info(`Watching ${activeWatchers.length} project(s). Press Ctrl+C to stop.`);

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
    console.log(`  Projects: ${config.projects.length}`);
    
    for (const project of config.projects) {
      console.log(`    - ${project.mandrel_project}: ${project.path}`);
    }
  } catch {
    console.log('\n  ⚠️  Could not load config');
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
