import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestContent } from '../helpers/content-loader.js';

// Run just the mute test to see detailed output
describe('Mute Test Only', async () => {
  let testRoom: string;
  let deviceId: string;
  let eventManager: EventManager;

  before(async () => {
    eventManager = EventManager.getInstance();
    await startEventBridge();
    const topology = await discoverSystem();
    testRoom = await getSafeTestRoom(topology);
    
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === testRoom);
    deviceId = device.id;
    
    await loadTestContent(testRoom);
  });

  after(async () => {
    stopEventBridge();
    eventManager.reset();
  });

  it('should handle mute, unmute, and togglemute endpoints correctly', async () => {
    // Step 1: Ensure we start unmuted
    console.log('Step 1: Ensuring device starts unmuted...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Give time for state to settle
    
    let response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    let state = await response.json();
    assert.equal(state.mute, false, 'Device should start unmuted');
    console.log(`✅ Device is unmuted`);
    
    // Step 2: Test /mute endpoint (should always mute)
    console.log('\nStep 2: Testing /mute endpoint...');
    const mutePromise = eventManager.waitForMute(deviceId, true, 5000);
    
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    const muteChanged = await mutePromise;
    assert(muteChanged, 'Should receive mute change event');
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    assert.equal(state.mute, true, 'Should be muted after calling /mute');
    console.log(`✅ /mute endpoint works correctly`);
    
    // Step 3: Test /mute again when already muted (should stay muted, no event)
    console.log('\nStep 3: Testing /mute when already muted...');
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/mute`);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    assert.equal(state.mute, true, 'Should remain muted when calling /mute on muted device');
    console.log(`✅ /mute correctly maintains muted state`);
    
    // Step 4: Test /unmute endpoint
    console.log('\nStep 4: Testing /unmute endpoint...');
    const unmutePromise = eventManager.waitForMute(deviceId, false, 5000);
    
    await fetch(`${defaultConfig.apiUrl}/${testRoom}/unmute`);
    const unmuteChanged = await unmutePromise;
    assert(unmuteChanged, 'Should receive unmute event');
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    assert.equal(state.mute, false, 'Should be unmuted after calling /unmute');
    console.log(`✅ /unmute endpoint works correctly`);
    
    // Step 5: Test /togglemute endpoint (should mute from unmuted state)
    console.log('\nStep 5: Testing /togglemute from unmuted state...');
    const toggleMutePromise1 = eventManager.waitForMute(deviceId, true, 5000);
    
    const toggleResponse1 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
    const toggleResult1 = await toggleResponse1.json();
    assert.equal(toggleResult1.muted, true, 'togglemute response should indicate muted');
    
    const toggleChanged1 = await toggleMutePromise1;
    assert(toggleChanged1, 'Should receive mute event from togglemute');
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    assert.equal(state.mute, true, 'Should be muted after togglemute from unmuted state');
    console.log(`✅ /togglemute correctly mutes from unmuted state`);
    
    // Step 6: Test /togglemute again (should unmute from muted state)
    console.log('\nStep 6: Testing /togglemute from muted state...');
    const toggleMutePromise2 = eventManager.waitForMute(deviceId, false, 5000);
    
    const toggleResponse2 = await fetch(`${defaultConfig.apiUrl}/${testRoom}/togglemute`);
    const toggleResult2 = await toggleResponse2.json();
    assert.equal(toggleResult2.muted, false, 'togglemute response should indicate unmuted');
    
    const toggleChanged2 = await toggleMutePromise2;
    assert(toggleChanged2, 'Should receive unmute event from togglemute');
    
    response = await fetch(`${defaultConfig.apiUrl}/${testRoom}/state`);
    state = await response.json();
    assert.equal(state.mute, false, 'Should be unmuted after togglemute from muted state');
    console.log(`✅ /togglemute correctly unmutes from muted state`);
  });
});