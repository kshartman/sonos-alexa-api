export interface TestConfig {
  apiUrl: string;
  testMode: 'mock-only' | 'integration';
  mockOnly: boolean;
  timeout: number;
}

export const defaultConfig: TestConfig = {
  apiUrl: process.env.TEST_API_URL || process.env.API_BASE_URL || 'http://localhost:5005',
  testMode: (process.env.TEST_MODE as any) || 'integration',
  mockOnly: process.env.MOCK_ONLY === 'true',
  timeout: parseInt(process.env.TEST_TIMEOUT || '10000', 10)
};

/**
 * Get test timeout value, respecting TEST_NO_TIMEOUT environment variable
 * @param defaultTimeout - Default timeout in milliseconds
 * @returns Timeout value (10 hours if TEST_NO_TIMEOUT is set, otherwise default)
 */
export function getTestTimeout(defaultTimeout: number): number {
  return process.env.TEST_NO_TIMEOUT === 'true' ? 36000000 : defaultTimeout;
}

export interface SystemTopology {
  zones: Zone[];
  rooms: string[];
  hasGroups: boolean;
  hasStereoPairs: boolean;
  stereoPairs?: string[];
  availableServices: string[];
  defaultRoom?: string;
  defaultService?: string;
  presetCount?: number;
}

export interface Zone {
  id: string;
  coordinator: string; // roomName of coordinator
  members: Array<{
    id: string;
    roomName: string;
    isCoordinator: boolean;
  }>;
}