#!/usr/bin/env bun
/**
 * Mandrel Watcher - CLI Entry Point
 * 
 * Background daemon that watches local git repositories and pushes
 * commit/file data to Mandrel API in real-time.
 */

import { Command } from 'commander';
import { startCommand, stopCommand, statusCommand, configInitCommand } from './cli/commands';

const program = new Command();

program
  .name('mandrel-watcher')
  .description('Watch git repositories and sync commits to Mandrel')
  .version('0.1.0');

program
  .command('start')
  .description('Start watching configured git repositories')
  .option('-f, --foreground', 'Run in foreground (don\'t daemonize)')
  .option('-d, --debug', 'Enable debug logging')
  .action(startCommand);

program
  .command('stop')
  .description('Stop the running watcher daemon')
  .action(stopCommand);

program
  .command('status')
  .description('Show current daemon status and configuration')
  .action(statusCommand);

program
  .command('config')
  .description('Configuration management')
  .command('init')
  .description('Create default configuration file')
  .action(configInitCommand);

// Parse CLI arguments
program.parse();
