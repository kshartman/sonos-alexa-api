import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { globalTestSetup, globalTestTeardown, TestContext } from '../helpers/global-test-setup.js';
import { defaultConfig, getTestTimeout } from '../helpers/test-config.js';
import { testLog } from '../helpers/test-logger.js';

// Skip all tests if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('System Discovery Tests', { skip: skipIntegration }, () => {
  let testContext: TestContext;
  let testRoom: string;
  
  before(async () => {
    testContext = await globalTestSetup('System Discovery Tests');
    testRoom = testContext.testRoom;
    
    const topology = testContext.topology;
    testLog.info(`📊 System discovered:`);
    testLog.info(`   - Rooms: ${topology.rooms.join(', ')}`);
    testLog.info(`   - Groups: ${topology.hasGroups ? 'Yes' : 'No'}`);
    testLog.info(`   - Stereo pairs: ${topology.hasStereoPairs ? `Yes (${topology.stereoPairs?.join(', ')})` : 'No'}`);
    testLog.info(`   - Services: ${topology.availableServices.join(', ')}`);
    testLog.info(`   - Default room: ${topology.defaultRoom || 'Not set'}`);
    testLog.info(`   - Default service: ${topology.defaultService || 'Not set'}`);
    testLog.info(`   - Presets: ${topology.presetCount || 0}`);
    testLog.info(`   - Test room: ${testRoom}`);
    testLog.info(`   - Test mode: ${defaultConfig.testMode}`);
  });

  describe('System Discovery', () => {
    it('should discover zones', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/zones`);
      assert.strictEqual(response.status, 200);
      const zones = await response.json();
      assert(Array.isArray(zones));
      assert(zones.length > 0);
    });

    it('should get system state', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/state`);
      assert.strictEqual(response.status, 200);
      const state = await response.json();
      assert(Array.isArray(state));
    });

    it('should check health', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/health`);
      assert.strictEqual(response.status, 200);
      const health = await response.json();
      assert.strictEqual(health.status, 'healthy');
      assert(health.devices > 0);
    });
  });

  // Generate test coverage report at the end
  after(async () => {
    testLog.info('\n📈 Test Coverage Summary:');
    testLog.info(`   - System discovery: ✓`);
    testLog.info(`   - Tested ${testContext?.topology?.rooms?.length || 0} rooms`);
    
    await globalTestTeardown('System Discovery Tests', testContext);
  });
});