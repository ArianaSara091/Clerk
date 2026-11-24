import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth } from 'firebase-admin/auth';
import { readEnv } from './env.ts';
import { BackendConfigError } from './types.ts';

function readProjectIdFromFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { projectId?: string };
    return typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
  } catch {
    return '';
  }
}

function resolveProjectId(): string {
  const fromEnv = readEnv('FIREBASE_PROJECT_ID');
  if (fromEnv) return fromEnv;

  const cwdPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const fromCwd = readProjectIdFromFile(cwdPath);
  if (fromCwd) return fromCwd;

  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const relPath = path.resolve(moduleDir, '../../firebase-applet-config.json');
      const fromModule = readProjectIdFromFile(relPath);
      if (fromModule) return fromModule;
    }
  } catch {
    // Ignore import.meta resolution in CommonJS bundles
  }

  throw new BackendConfigError(
    503,
    'FIREBASE_PROJECT_ID is not configured and firebase-applet-config.json could not be loaded.'
  );
}

export function isFirebaseAdminConfigured(): boolean {
  try {
    return Boolean(resolveProjectId());
  } catch {
    return false;
  }
}

export function getFirebaseAdminAuth(): Auth {
  const projectId = resolveProjectId();
  const app = getApps().length ? getApps()[0] : initializeAdminApp({ projectId });
  return getAdminAuth(app);
}
