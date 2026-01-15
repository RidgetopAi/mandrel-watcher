/**
 * ConfigManager - Load and manage TOML configuration
 */

import { parse as parseToml } from '@iarna/toml';
import { logger } from '../utils/logger';
import { homedir } from 'os';
import { join } from 'path';

export interface ProjectConfig {
  path: string;
  mandrel_project: string;
}

export interface WatcherConfig {
  api_url: string;
  auth_token?: string;
  session_poll_interval: number;
  debounce_ms: number;
  projects: ProjectConfig[];
}

const DEFAULT_CONFIG: WatcherConfig = {
  api_url: 'https://mandrel.ridgetopai.net',
  session_poll_interval: 30,
  debounce_ms: 2000,
  projects: [],
};

export class ConfigManager {
  private config: WatcherConfig = DEFAULT_CONFIG;
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), '.config', 'mandrel-watcher', 'config.toml');
  }

  async load(): Promise<WatcherConfig> {
    try {
      const file = Bun.file(this.configPath);
      const exists = await file.exists();

      if (!exists) {
        logger.warn(`Config file not found: ${this.configPath}`);
        logger.info('Using default configuration. Run "mandrel-watcher config init" to create one.');
        return this.config;
      }

      const content = await file.text();
      const parsed = parseToml(content) as Partial<WatcherConfig>;

      this.config = {
        ...DEFAULT_CONFIG,
        ...parsed,
        projects: parsed.projects || [],
      };

      logger.info(`Loaded config from ${this.configPath}`);
      logger.debug(`Watching ${this.config.projects.length} project(s)`);

      return this.config;
    } catch (error) {
      logger.error('Failed to load config:', error);
      throw error;
    }
  }

  get(): WatcherConfig {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async createDefault(): Promise<void> {
    const defaultContent = `# Mandrel Watcher Configuration
# API endpoint for Mandrel
api_url = "https://mandrel.ridgetopai.net"

# Authentication token (get from Mandrel UI)
# auth_token = "your-jwt-token"

# How often to check for active session (seconds)
session_poll_interval = 30

# Debounce time for git events (milliseconds)
debounce_ms = 2000

# Projects to watch
# [[projects]]
# path = "/home/user/myproject"
# mandrel_project = "my-project-name"
`;

    const dir = join(homedir(), '.config', 'mandrel-watcher');
    await Bun.$`mkdir -p ${dir}`.quiet();
    
    await Bun.write(this.configPath, defaultContent);
    logger.info(`Created default config at ${this.configPath}`);
  }
}

export const configManager = new ConfigManager();
