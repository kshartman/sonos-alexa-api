#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServer, stopServer, isServerRunning, waitForServer } from './helpers/server-manager.js';
import { DebugSettingsManager } from './helpers/debug-settings-manager.js';
import { defaultConfig } from './helpers/test-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🧪 Sonos API Test Suite\n');

// Parse command line arguments
const args = process.argv.slice(2);
const mockOnly = args.includes('--mock-only');
const noServer = args.includes('--no-server');

// Extract grep pattern if provided
let grepPattern: string | undefined;
const grepIndex = args.findIndex(arg => arg === '--grep' || arg.startsWith('--grep='));
if (grepIndex !== -1) {
  const grepArg = args[grepIndex];
  if (grepArg === '--grep' && args[grepIndex + 1]) {
    grepPattern = args[grepIndex + 1];
  } else if (grepArg.startsWith('--grep=')) {
    grepPattern = grepArg.substring('--grep='.length);
  }
}

// Extract file pattern
const pattern = args.find(arg => !arg.startsWith('--') && arg !== grepPattern) || '{unit,integration}/**/*-tests.ts';

// Determine test mode: mock-only vs integration (always destructive)
const testMode = mockOnly ? 'mock-only' : 'integration';

// Set environment variables
process.env.TEST_MODE = testMode;
process.env.MOCK_ONLY = mockOnly ? 'true' : 'false';

console.log(`📋 Configuration:`);
console.log(`   Mode: ${testMode}`);
console.log(`   Mock only: ${mockOnly}`);
console.log(`   API URL: ${process.env.TEST_API_URL || 'http://localhost:5005'}`);
console.log(`   Auto-start server: ${!noServer && !process.env.TEST_API_URL}`);
console.log(`   Pattern: ${pattern}`);
if (grepPattern) {
  console.log(`   Grep: ${grepPattern}`);
}
console.log(`   Concurrency: Sequential (1 test file at a time)\n`);

if (!mockOnly) {
  console.log('⚠️  Integration tests will run against your Sonos system.');
  console.log('   Use --mock-only to run only unit tests.\n');
}

async function runTests() {
  let shouldStopServer = false;
  const debugManager = new DebugSettingsManager();

  try {
    // Check if we need to start the server
    if (!mockOnly && !noServer) {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('🚀 Starting API server for tests...');
        await startServer();
        await waitForServer();
        shouldStopServer = true;
      } else {
        console.log('✅ Server already running\n');
      }
      
      // Save current debug settings and enable debug mode
      console.log('🔧 Configuring debug settings for tests...');
      await debugManager.save();
      await debugManager.enableDebugMode();
      console.log('');
    }

    // Run tests using tsx to handle TypeScript files
    // IMPORTANT: Using --test-concurrency=1 to run tests sequentially
    const testArgs = [
      'tsx',
      '--test',
      '--test-concurrency=1',  // Force sequential execution
      '--test-reporter=spec'
    ];
    
    // Add grep pattern if provided
    if (grepPattern) {
      testArgs.push(`--test-name-pattern=${grepPattern}`);
    }
    
    // Don't prepend test/ if pattern already includes it
    testArgs.push(pattern.startsWith('test/') ? pattern : `test/${pattern}`);
    
    const testProcess = spawn('npx', testArgs, {
      stdio: 'inherit',
      cwd: join(__dirname, '..'),
      env: { ...process.env }
    });

    testProcess.on('close', async (code) => {
      // Restore debug settings
      if (!mockOnly && !noServer) {
        console.log('\n🔧 Restoring debug settings...');
        await debugManager.restore();
      }
      
      // Clean up server if we started it
      if (shouldStopServer) {
        console.log('\n🛑 Stopping test server...');
        await stopServer();
      }

      if (code === 0) {
        console.log('\n✅ All tests passed!');
      } else {
        console.log(`\n❌ Tests failed with code ${code}`);
      }
      process.exit(code || 0);
    });

  } catch (error) {
    console.error('❌ Failed to start tests:', error);
    
    // Restore debug settings on error
    if (!mockOnly && !noServer) {
      console.log('\n🔧 Restoring debug settings...');
      await debugManager.restore();
    }
    
    if (shouldStopServer) {
      await stopServer();
    }
    process.exit(1);
  }
}

// Help text
if (args.includes('--help')) {
  console.log(`
Usage: npm test [options] [pattern]

Options:
  --mock-only     Run only unit tests (no Sonos required)
  --no-server     Don't auto-start server (assume it's running)
  --grep PATTERN  Filter tests by name pattern
  --help          Show this help

Examples:
  npm test                            # Run all tests
  npm test --mock-only                # Run only unit tests
  npm test unit/*.ts                  # Run only unit tests by pattern
  npm test -- --grep "Pandora"        # Run only tests matching "Pandora"
  npm test -- "--grep=Pandora Service" # Alternative grep syntax
  `);
  process.exit(0);
}

// Run the tests
runTests();