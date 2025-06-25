#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServer, stopServer, isServerRunning, waitForServer } from './helpers/server-manager.js';

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
console.log(`   Auto-start server: ${!noServer}`);
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
      
      // Enable debug logging on the server
      try {
        console.log('🔧 Enabling debug logging on server...');
        // Enable all debug categories
        const enableAllResponse = await fetch('http://localhost:5005/debug/enable-all');
        if (enableAllResponse.ok) {
          console.log('✅ All debug categories enabled on server');
        }
        
        // Set log level to debug (sets both logger and debugManager)
        const logLevelResponse = await fetch('http://localhost:5005/loglevel/debug');
        if (logLevelResponse.ok) {
          console.log('✅ Server log level set to debug\n');
        }
      } catch (error) {
        console.warn('⚠️  Could not enable debug logging on server:', error);
      }
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