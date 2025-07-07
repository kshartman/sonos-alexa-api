#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startServer, stopServer, isServerRunning, waitForServer } from './helpers/server-manager.js';
import { defaultConfig } from './helpers/test-config.js';
import { clearTestContentCache } from './helpers/test-content-cache.js';
import * as dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load test environment variables
dotenv.config({ path: join(__dirname, '.env') });

console.log('🧪 Sonos API Test Suite\n');

// Parse command line arguments
const args = process.argv.slice(2);
const mockOnly = args.includes('--mock-only');
const noServer = args.includes('--no-server') || process.env.NO_SERVER === 'true';
const enableInteractive = args.includes('--interactive');
const noTimeout = args.includes('--no-timeout') || enableInteractive; // Interactive mode implies no timeout
const enableLogging = args.includes('--log');
const debugMode = args.includes('--debug');
const traceMode = args.includes('--trace');

// Extract grep pattern if provided (--match is an undocumented synonym for --grep)
let grepPattern: string | undefined;
const grepIndex = args.findIndex(arg => arg === '--grep' || arg.startsWith('--grep=') || arg === '--match' || arg.startsWith('--match='));
if (grepIndex !== -1) {
  const grepArg = args[grepIndex];
  if ((grepArg === '--grep' || grepArg === '--match') && args[grepIndex + 1]) {
    grepPattern = args[grepIndex + 1];
  } else if (grepArg.startsWith('--grep=')) {
    grepPattern = grepArg.substring('--grep='.length);
  } else if (grepArg.startsWith('--match=')) {
    grepPattern = grepArg.substring('--match='.length);
  }
}

// Extract file pattern
const pattern = args.find(arg => !arg.startsWith('--') && arg !== grepPattern) || '{unit,integration}/**/*-tests.ts';

// Determine test mode: mock-only vs integration (always destructive)
const testMode = mockOnly ? 'mock-only' : 'integration';

// Set environment variables
process.env.TEST_MODE = testMode;
process.env.MOCK_ONLY = mockOnly ? 'true' : 'false';

// Set log level for test process (affects EventBridge and other helpers that use the logger)
if (traceMode) {
  process.env.LOG_LEVEL = 'trace';
} else if (debugMode) {
  process.env.LOG_LEVEL = 'debug';
} else if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';  // Only show errors during tests unless explicitly set
}

// Get the actual API URL that will be used
const apiUrl = process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:5005';
const isRemoteApi = !apiUrl.includes('localhost') && !apiUrl.includes('127.0.0.1');
const shouldAutoStart = !noServer && !isRemoteApi && !mockOnly;

// Generate log filename early so we can show it in configuration
let logFilename: string | undefined;
if (enableLogging) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  logFilename = `test-run-${timestamp}.log`;
}

console.log(`📋 Configuration:`);
console.log(`   Mode: ${testMode}`);
console.log(`   Mock only: ${mockOnly}`);
console.log(`   API URL: ${apiUrl}`);
console.log(`   Remote API: ${isRemoteApi}`);
console.log(`   Auto-start server: ${shouldAutoStart}`);
console.log(`   Pattern: ${pattern}`);
if (grepPattern) {
  console.log(`   Grep: ${grepPattern}`);
}
console.log(`   Concurrency: Sequential (1 test file at a time)`);
if (noTimeout) {
  console.log(`   Timeouts: Disabled`);
}
if (enableLogging && logFilename) {
  console.log(`   Logging: Enabled (logs/${logFilename})`);
}
if (enableInteractive) {
  console.log(`   Interactive: Enabled (will pause for user input, timeouts disabled)`);
}
if (debugMode || traceMode) {
  console.log(`   Log Level: ${process.env.LOG_LEVEL}`);
}
console.log();

if (!mockOnly) {
  console.log('⚠️  Integration tests will run against your Sonos system.');
  console.log('   Use --mock-only to run only unit tests.\n');
}

async function handleTestExit(code: number, shouldStopServer: boolean, enableLogging: boolean, logPath?: string) {
  // Clean up server if we started it
  if (shouldStopServer) {
    console.log('\n🛑 Stopping test server...');
    await stopServer();
  }

  if (code === 0) {
    console.log('\n✅ All tests passed!');
    if (enableLogging && logPath) {
      console.log(`📝 Test log saved to: ${logPath}`);
    }
  } else {
    console.log(`\n❌ Tests failed with code ${code}`);
    if (enableLogging && logPath) {
      console.log(`📝 Test log saved to: ${logPath}`);
    }
  }
  process.exit(code);
}

async function runTests() {
  let shouldStopServer = false;

  try {
    // Check if we need to start the server
    if (!mockOnly && !noServer && !process.env.TEST_API_URL && !process.env.API_BASE_URL) {
      const serverRunning = await isServerRunning();
      if (!serverRunning) {
        console.log('🚀 Starting API server for tests...');
        await startServer();
        await waitForServer();
        shouldStopServer = true;
      } else {
        console.log('✅ Server already running\n');
      }
    } else if (isRemoteApi) {
      console.log(`🌐 Using remote API at ${apiUrl}\n`);
    }
    
    // Clear test content cache to ensure fresh discovery
    await clearTestContentCache();

    // Run tests using tsx to handle TypeScript files
    // IMPORTANT: Using --test-concurrency=1 to run tests sequentially
    const testArgs = [
      'tsx',
      '--test',
      '--test-concurrency=1',  // Force sequential execution
      '--test-reporter=spec'
    ];
    
    // Disable test timeout if requested
    if (noTimeout) {
      testArgs.push('--test-timeout=0');
      console.log('⏱️  Test timeouts disabled\n');
    }
    
    // Add grep pattern if provided
    if (grepPattern) {
      testArgs.push(`--test-name-pattern=${grepPattern}`);
    }
    
    // Don't prepend test/ if pattern already includes it
    testArgs.push(pattern.startsWith('test/') ? pattern : `test/${pattern}`);
    
    // Set environment variables for test process
    const testEnv = { 
      ...process.env,
      TEST_LOGGING: enableLogging ? 'true' : 'false',
      TEST_INTERACTIVE: enableInteractive ? 'true' : 'false',
      TEST_NO_TIMEOUT: (noTimeout || enableInteractive) ? 'true' : 'false'
    };
    
    // Generate log file path if logging is enabled
    if (enableLogging && logFilename) {
      testEnv.TEST_LOG_PATH = join(__dirname, '..', 'logs', logFilename);
      console.log(`📝 Test output will be logged to: ${testEnv.TEST_LOG_PATH}\n`);
    }
    
    // Debug: Show the actual command being run
    if (debugMode || traceMode) {
      console.log(`🔍 Running: npx ${testArgs.join(' ')}\n`);
    }
    
    // Run tests with proper stdio configuration
    const testProcess = spawn('npx', testArgs, {
      stdio: enableInteractive ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      cwd: join(__dirname, '..'),
      env: testEnv
    });
    
    // Monitor stdout for interactive wait markers if in interactive mode
    if (enableInteractive && testProcess.stdout) {
      testProcess.stdout.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(output);
        
        // Check for wait marker
        if (output.includes('[WAITING_FOR_EXTERNAL_TRIGGER]')) {
          const triggerFile = join(__dirname, '..', 'tmp', 'test-continue.flag');
          console.log('\n🔔 Test is waiting for user action!');
          console.log(`📝 To continue: touch ${triggerFile}`);
          console.log(`   Or run: ${join(__dirname, 'continue.sh')}\n`);
        }
      });
    }
    
    testProcess.on('close', async (code) => {
      await handleTestExit(code || 0, shouldStopServer, enableLogging, testEnv.TEST_LOG_PATH);
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
  --no-timeout    Disable test timeouts (for interactive debugging)
  --log           Log test output to file
  --interactive   Enable interactive mode (pause for user input, implies --no-timeout)
  --debug         Enable debug logging (sets LOG_LEVEL=debug)
  --trace         Enable trace logging (sets LOG_LEVEL=trace)
  --grep PATTERN  Filter tests by name pattern
  --help          Show this help

Examples:
  npm test                            # Run all tests
  npm test --mock-only                # Run only unit tests
  npm test unit/*.ts                  # Run only unit tests by pattern
  npm test -- --grep "Pandora"        # Run only tests matching "Pandora"
  npm test -- "--grep=Pandora Service" # Alternative grep syntax
  npm test -- --interactive test/integration/04-content-pandora-tests.ts # Interactive test (timeouts auto-disabled)
  npm test -- --log --interactive test/integration/04-content-pandora-tests.ts # Interactive test with logging
  `);
  process.exit(0);
}

// Run the tests
runTests();