#!/usr/bin/env node
import { execSync } from 'child_process';
import { copyFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

console.log('Building React Router app...');

try {
  // Build the React Router app
  execSync('npx react-router build', { stdio: 'inherit' });

  // Debug: Check what was created
  console.log('\nChecking build output...');
  if (existsSync('build')) {
    console.log('build/ contents:', readdirSync('build'));
    if (existsSync('build/server')) {
      console.log('build/server/ contents:', readdirSync('build/server'));
    }
    if (existsSync('build/client')) {
      console.log('build/client/ contents:', readdirSync('build/client'));
    }
  } else {
    console.error('build/ directory does not exist!');
  }

  // Check if build was successful
  const serverBundlePath = resolve('build/server/index.js');
  if (!existsSync(serverBundlePath)) {
    console.error('\nError: build/server/index.js not found.');
    console.error('Expected path:', serverBundlePath);
    process.exit(1);
  }

  // Copy server bundle to client directory
  console.log('Copying server bundle to client directory...');
  copyFileSync(
    serverBundlePath,
    resolve('build/client/server.js')
  );

  // Create Cloudflare Pages Functions directory
  console.log('Creating Cloudflare Pages function...');

  const { mkdirSync } = await import('fs');
  mkdirSync(resolve('build/client/functions'), { recursive: true });

  const functionContent = `import * as build from '../server.js';
import { createRequestHandler } from '@react-router/cloudflare';

// createRequestHandler returns a PagesFunction which can be used directly
export const onRequest = createRequestHandler({ build, mode: 'production' });
`;

  writeFileSync(
    resolve('build/client/functions/[[path]].js'),
    functionContent
  );

  console.log('Build complete! Ready to deploy to Cloudflare Pages.');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
