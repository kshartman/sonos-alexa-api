import { spawn, ChildProcess } from 'child_process';
import { defaultConfig } from './test-config.js';

let serverProcess: ChildProcess | null = null;

/**
 * Start the API server for testing
 */
export async function startServer(): Promise<void> {
  // Check if using external server
  const externalHost = process.env.TEST_API_URL && !process.env.TEST_API_URL.includes('localhost');
  if (externalHost) {
    console.log(`🌐 Using external server: ${process.env.TEST_API_URL}`);
    return;
  }

  if (serverProcess) {
    console.log('Server already running');
    return;
  }

  console.log('🚀 Starting API server...');
  
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
          console.log('✅ Server started successfully');
          resolve();
        }
      }
    });

    serverProcess.stderr?.on('data', (data) => {
      console.error('Server error:', data.toString());
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

  console.log('🛑 Stopping API server...');
  
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
    const response = await fetch(`${defaultConfig.apiUrl}/health`);
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