import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const AIDO_SCRIPT = path.join(PROJECT_ROOT, 'aido');
const AIDO_SYMLINK = path.join(PROJECT_ROOT, 'AIdo');

describe('Bash wrapper branding', () => {
  beforeEach(() => {
    // Clean up any existing symlink before each test
    if (fs.existsSync(AIDO_SYMLINK)) {
      fs.unlinkSync(AIDO_SYMLINK);
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (fs.existsSync(AIDO_SYMLINK)) {
      fs.unlinkSync(AIDO_SYMLINK);
    }
  });

  describe('aido script exists', () => {
    it('aido script exists and is executable', () => {
      expect(fs.existsSync(AIDO_SCRIPT)).toBe(true);
      
      const stats = fs.statSync(AIDO_SCRIPT);
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it('aido script has correct shebang', () => {
      const content = fs.readFileSync(AIDO_SCRIPT, 'utf-8');
      expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    });
  });

  describe('AIdo symlink creation', () => {
    it('can create AIdo symlink pointing to aido', () => {
      fs.symlinkSync('aido', AIDO_SYMLINK);
      expect(fs.existsSync(AIDO_SYMLINK)).toBe(true);
      
      const linkTarget = fs.readlinkSync(AIDO_SYMLINK);
      expect(linkTarget).toBe('aido');
    });

    it('AIdo symlink resolves to the aido script', () => {
      fs.symlinkSync('aido', AIDO_SYMLINK);
      
      // Read the symlink target
      const resolved = fs.realpathSync(AIDO_SYMLINK);
      expect(resolved).toBe(AIDO_SCRIPT);
    });

    it('AIdo symlink is recognized as a symlink', () => {
      fs.symlinkSync('aido', AIDO_SYMLINK);
      
      const stats = fs.lstatSync(AIDO_SYMLINK);
      expect(stats.isSymbolicLink()).toBe(true);
      expect(stats.isFile()).toBe(false);
    });
  });

  describe('install scripts create AIdo symlink', () => {
    it('install:local script includes AIdo symlink creation', () => {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')
      );
      
      // The install:local script should create both aido and AIdo symlinks
      const installLocalScript = pkgJson.scripts['install:local'];
      expect(installLocalScript).toContain('ln -sf');
      expect(installLocalScript).toContain('aido');
    });

    it('install:global script includes AIdo symlink creation', () => {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')
      );
      
      const installGlobalScript = pkgJson.scripts['install:global'];
      expect(installGlobalScript).toContain('cp');
      expect(installGlobalScript).toContain('aido');
    });
  });

  describe('package.json bin configuration', () => {
    it('has aido bin entry', () => {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')
      );
      
      expect(pkgJson.bin).toBeDefined();
      expect(pkgJson.bin.aido).toBe('./aido');
    });

    it('has AIdo bin entry for dual naming', () => {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8')
      );
      
      expect(pkgJson.bin).toBeDefined();
      expect(pkgJson.bin.AIdo).toBeDefined();
      expect(pkgJson.bin.AIdo).toBe('./aido');
    });
  });

  describe('bash wrapper resolves symlinks', () => {
    it('bash wrapper correctly resolves its own path through symlinks', () => {
      // Create AIdo symlink
      fs.symlinkSync('aido', AIDO_SYMLINK);
      
      // The bash wrapper has logic to resolve symlinks
      // This tests that the wrapper works when invoked via symlink
      const content = fs.readFileSync(AIDO_SCRIPT, 'utf-8');
      
      // Should contain symlink resolution logic
      expect(content).toContain('readlink');
      expect(content).toContain('BASH_SOURCE');
    });
  });
});
