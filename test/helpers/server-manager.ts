import { spawn, ChildProcess } from 'child_process';
import { defaultConfig } from './test-config.js';
import { testLog } from './test-logger.js';

let serverProcess: ChildProcess | null = null;

/**
 * Start the API server for testing
 */
export async function startServer(): Promise<void> {
  // Check if using external server
  const externalHost = process.env.TEST_API_URL && !process.env.TEST_API_URL.includes('localhost');
  if (externalHost) {
    testLog.info(`🌐 Using external server: ${process.env.TEST_API_URL}`);
    return;
  }

  if (serverProcess) {
    testLog.info('Server already running');
    return;
  }

  testLog.info('🚀 Starting API server...');
  
  return new Promise((resolve, reject) => {
    // Start the server
    serverProcess = spawn('node', ['--openssl-legacy-provider', 'dist/server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: '5005',
        LOG_LEVEL: 'error' // Reduce noise during tests
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let startupTimeout: NodeJS.Timeout;
    let isResolved = false;

    const cleanup = () => {
      if (startupTimeout) clearTimeout(startupTimeout);
      isResolved = true;
    };

    // Handle server output
    serverProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      // Look for server ready message
      if (output.includes('System ready for Alexa requests') || 
          output.includes('Server running on port')) {
        cleanup();
        if (!isResolved) {
          testLog.info('✅ Server started successfully');
          resolve();
        }
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      testLog.error('Server error:', data.toString());
    });

    serverProcess.on('error', (error) => {
      cleanup();
      reject(new Error(`Failed to start server: ${error.message}`));
    });

    serverProcess.on('exit', (code) => {
      cleanup();
      serverProcess = null;
      if (!isResolved) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout if server doesn't start
    startupTimeout = setTimeout(() => {
      cleanup();
      if (!isResolved) {
        reject(new Error('Server startup timeout'));
      }
    }, 15000);
  });
}

/**
 * Stop the API server
 */
export async function stopServer(): Promise<void> {
  // Skip if using external server
  const externalHost = process.env.TEST_API_URL && !process.env.TEST_API_URL.includes('localhost');
  if (externalHost) {
    return;
  }

  if (!serverProcess) {
    return;
  }

  testLog.info('🛑 Stopping API server...');
  
  return new Promise((resolve) => {
    const cleanup = () => {
      serverProcess = null;
      resolve();
    };

    serverProcess.on('exit', cleanup);
    
    // Try graceful shutdown first
    serverProcess.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        cleanup();
      }
    }, 5000);
  });
}

/**
 * Check if the API server is running
 */
export async function isServerRunning(): Promise<boolean> {
  try {
    // Parse URL to extract auth if present
    const url = new URL(defaultConfig.apiUrl);
    const headers: HeadersInit = {};
    
    // If URL contains auth, add it as Basic Auth header
    if (url.username && url.password) {
      const auth = Buffer.from(`${url.username}:${url.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
      // Remove auth from URL for fetch
      url.username = '';
      url.password = '';
    }
    
    const response = await fetch(`${url.origin}/health`, { headers });
    if (!response.ok) return false;
    
    const data = await response.json();
    // Verify it's our server by checking the response structure
    return data.status === 'healthy' && typeof data.devices === 'number';
  } catch {
    return false;
  }
}

/**
 * Wait for the server to be ready
 */
export async function waitForServer(timeout = 10000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await isServerRunning()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error('Server did not become ready in time');
}