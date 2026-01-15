/**
 * ConfigManager - Load configuration and fetch projects from Mandrel API
 */

import { parse as parseToml } from '@iarna/toml';
import { logger } from '../utils/logger';
import { homedir } from 'os';
import { join } from 'path';

export interface ProjectConfig {
  path: string;
  mandrel_project: string;
  project_id?: string;
}

export interface WatcherConfig {
  api_url: string;
  auth_token?: string;
  session_poll_interval: number;
  debounce_ms: number;
  project_refresh_interval: number; // How often to re-fetch projects (seconds)
  projects: ProjectConfig[];
}

interface WatchableProject {
  id: string;
  name: string;
  root_directory: string;
}

interface WatchableResponse {
  success: boolean;
  data?: {
    projects: WatchableProject[];
    total: number;
  };
  error?: string;
}

const DEFAULT_CONFIG: WatcherConfig = {
  api_url: 'https://command.ridgetopai.net',
  session_poll_interval: 30,
  debounce_ms: 2000,
  project_refresh_interval: 300, // 5 minutes
  projects: [],
};

export class ConfigManager {
  private config: WatcherConfig = DEFAULT_CONFIG;
  private configPath: string;
  private lastProjectFetch: number = 0;

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), '.config', 'mandrel-watcher', 'config.toml');
  }

  /**
   * Load base config from TOML file
   */
  async load(): Promise<WatcherConfig> {
    try {
      const file = Bun.file(this.configPath);
      const exists = await file.exists();

      if (!exists) {
        logger.warn(`Config file not found: ${this.configPath}`);
        logger.info('Using default configuration. Run "mandrel-watcher config init" to create one.');
      } else {
        const content = await file.text();
        const parsed = parseToml(content) as Partial<WatcherConfig>;

        this.config = {
          ...DEFAULT_CONFIG,
          ...parsed,
          // Static projects from config are kept as fallback
          projects: parsed.projects || [],
        };

        logger.info(`Loaded config from ${this.configPath}`);
      }

      // Fetch projects from API
      await this.fetchProjects();

      return this.config;
    } catch (error) {
      logger.error('Failed to load config:', error);
      throw error;
    }
  }

  /**
   * Fetch projects from Mandrel API
   * Projects with root_directory set will be watched
   */
  async fetchProjects(): Promise<ProjectConfig[]> {
    try {
      const url = `${this.config.api_url}/api/projects/watchable`;
      logger.debug(`Fetching projects from ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.auth_token && { 'Authorization': `Bearer ${this.config.auth_token}` }),
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as WatchableResponse;

      if (!data.success || !data.data) {
        throw new Error(data.error || 'Invalid API response');
      }

      // Convert API response to ProjectConfig format
      const apiProjects: ProjectConfig[] = data.data.projects.map(p => ({
        path: p.root_directory,
        mandrel_project: p.name,
        project_id: p.id,
      }));

      // Merge with any static projects from config (API projects take precedence)
      const staticProjects = this.config.projects.filter(
        sp => !apiProjects.some(ap => ap.path === sp.path)
      );

      this.config.projects = [...apiProjects, ...staticProjects];
      this.lastProjectFetch = Date.now();

      logger.info(`Fetched ${apiProjects.length} project(s) from Mandrel API`);
      logger.debug(`Projects: ${this.config.projects.map(p => p.mandrel_project).join(', ')}`);

      return this.config.projects;
    } catch (error) {
      logger.warn('Failed to fetch projects from API, using cached/static config:', error);
      return this.config.projects;
    }
  }

  /**
   * Check if projects should be refreshed
   */
  shouldRefreshProjects(): boolean {
    const elapsed = (Date.now() - this.lastProjectFetch) / 1000;
    return elapsed >= this.config.project_refresh_interval;
  }

  /**
   * Refresh projects if needed
   */
  async refreshProjectsIfNeeded(): Promise<boolean> {
    if (this.shouldRefreshProjects()) {
      const oldCount = this.config.projects.length;
      await this.fetchProjects();
      return this.config.projects.length !== oldCount;
    }
    return false;
  }

  get(): WatcherConfig {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async createDefault(): Promise<void> {
    const defaultContent = `# Mandrel Watcher Configuration

# API endpoint for Mandrel Command backend
# Projects are fetched dynamically from this endpoint
api_url = "https://command.ridgetopai.net"

# Authentication token (optional, get from Mandrel UI if needed)
# auth_token = "your-jwt-token"

# How often to check for active session (seconds)
session_poll_interval = 30

# How often to re-fetch projects from Mandrel (seconds)
project_refresh_interval = 300

# Debounce time for git events (milliseconds)
debounce_ms = 2000

# Static projects (optional fallback - API projects take precedence)
# Set root_directory in Mandrel project settings to enable watching
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
