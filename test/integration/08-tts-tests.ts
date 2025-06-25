import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventManager } from '../../src/utils/event-manager.js';
import { defaultConfig } from '../helpers/test-config.js';
import { discoverSystem, getSafeTestRoom } from '../helpers/discovery.js';
import { startEventBridge, stopEventBridge } from '../helpers/event-bridge.js';
import { loadTestContent } from '../helpers/content-loader.js';

// Skip if in mock-only mode
const skipIntegration = defaultConfig.mockOnly;

describe('Text-to-Speech (TTS) Tests', { skip: skipIntegration }, () => {
  let eventManager: EventManager;
  let room: string;
  let deviceId: string;
  let originalVolume: number;
  let wasPlaying = false;
  
  before(async () => {
    console.log('🗣️  Testing text-to-speech...');
    eventManager = EventManager.getInstance();
    
    // Start event bridge to receive UPnP events via SSE
    await startEventBridge();
    
    // Discover system and select test room
    const topology = await discoverSystem();
    room = await getSafeTestRoom(topology);
    
    if (!room) {
      throw new Error('No suitable test room found');
    }
    
    console.log(`   Test room: ${room}`);
    
    // Get device ID for event tracking
    const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
    const zones = await zonesResponse.json();
    const device = zones.flatMap(z => z.members).find(m => m.roomName === room);
    
    if (!device) {
      throw new Error(`Device not found for room ${room}`);
    }
    
    deviceId = device.id;
    console.log(`   Device ID: ${deviceId}`);
    
    // Get initial state
    const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
    const state = await stateResponse.json();
    originalVolume = state.volume;
    wasPlaying = state.playbackState === 'PLAYING';
    
    // Load some content for state restoration tests
    if (!wasPlaying) {
      console.log('   Loading content for state restoration tests...');
      const contentLoaded = await loadTestContent(room);
      if (contentLoaded) {
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    }
  });
  
  after(async () => {
    // Restore original state
    if (room) {
      await fetch(`${defaultConfig.apiUrl}/${room}/volume/${originalVolume}`);
      if (!wasPlaying) {
        await fetch(`${defaultConfig.apiUrl}/${room}/stop`);
      }
    }
    
    // Stop event bridge
    stopEventBridge();
    console.log('   ✓ TTS tests complete');
  });
  
  describe('Basic TTS', () => {
    it('should say simple text', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/Hello%20world`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'TTS should succeed');
      
      // Wait for announcement to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Should restore previous state
      const restored = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      assert(restored, 'Should restore playback after announcement');
    });
    
    it('should handle text with special characters', async () => {
      const text = encodeURIComponent("It's 5 o'clock! Time for $10 coffee?");
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${text}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for announcement
      await new Promise(resolve => setTimeout(resolve, 4000));
    });
    
    it('should handle long text', async () => {
      const longText = encodeURIComponent("This is a longer announcement to test how the system handles multiple sentences. It should speak clearly and then restore the previous playback state.");
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${longText}`);
      assert.strictEqual(response.status, 200);
      
      // Wait for longer announcement
      await new Promise(resolve => setTimeout(resolve, 6000));
    });
  });
  
  describe('TTS with Volume', () => {
    it('should say text at specific volume', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/Testing%20volume/50`);
      assert.strictEqual(response.status, 200);
      
      // Wait for announcement
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Volume should be restored
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      assert.strictEqual(state.volume, originalVolume, 'Volume should be restored');
    });
    
    it('should handle volume bounds', async () => {
      // Test with volume too high
      const response1 = await fetch(`${defaultConfig.apiUrl}/${room}/say/Maximum%20volume/150`);
      assert.strictEqual(response1.status, 200); // Should clamp to 100
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Test with volume too low
      const response2 = await fetch(`${defaultConfig.apiUrl}/${room}/say/Minimum%20volume/-10`);
      assert.strictEqual(response2.status, 200); // Should clamp to 0
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
  });
  
  describe('Say All Command', () => {
    it('should announce to all rooms', async () => {
      // Get initial state of test room
      const beforeState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateBefore = await beforeState.json();
      const wasPlaying = stateBefore.playbackState === 'PLAYING';
      
      const response = await fetch(`${defaultConfig.apiUrl}/sayall/Attention%20all%20rooms`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Say all should succeed');
      
      // Wait for announcement to play
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // If test room was playing, wait for it to restore
      if (wasPlaying) {
        const restored = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
        assert(restored, 'Should restore playback after announcement');
      }
    });
    
    it('should announce to all rooms with volume', async () => {
      // Get all rooms and their initial volumes
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      const allRooms = zones.flatMap(z => z.members);
      
      // Store initial volumes for all rooms
      const roomVolumes = new Map();
      for (const member of allRooms) {
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${member.roomName}/state`);
        const state = await stateResponse.json();
        roomVolumes.set(member.id, state.volume);
      }
      
      const response = await fetch(`${defaultConfig.apiUrl}/sayall/Testing%20all%20rooms/40`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Say all with volume should succeed');
      
      // Wait for announcement to play
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if at least one room has restored its volume
      let volumeRestored = false;
      const volumePromises = [];
      
      // Create promises for all rooms but don't wait for all
      for (const [roomId, originalVolume] of roomVolumes) {
        volumePromises.push(
          eventManager.waitForVolume(roomId, originalVolume, 5000)
            .then(restored => ({ roomId, restored }))
            .catch(() => ({ roomId, restored: false }))
        );
      }
      
      // Wait for any room to restore volume
      const results = await Promise.race([
        Promise.all(volumePromises),
        new Promise(resolve => setTimeout(() => resolve([]), 8000)) // Overall timeout
      ]);
      
      if (Array.isArray(results)) {
        volumeRestored = results.some(r => r.restored);
      }
      
      assert(volumeRestored, 'At least one room should restore original volume');
    });
    
    it('should announce to all rooms from specific room', async () => {
      // Get initial state of test room
      const beforeState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateBefore = await beforeState.json();
      const wasPlaying = stateBefore.playbackState === 'PLAYING';
      
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/sayall/Room%20announcement`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Room sayall should succeed');
      
      // Wait for announcement to play
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // If test room was playing, wait for it to restore
      if (wasPlaying) {
        const restored = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
        assert(restored, 'Should restore playback after announcement');
      }
    });
    
    it('should announce to all rooms from specific room with volume', async () => {
      // Get the zone that contains our test room
      const zonesResponse = await fetch(`${defaultConfig.apiUrl}/zones`);
      const zones = await zonesResponse.json();
      const testZone = zones.find(z => z.members.some(m => m.roomName === room));
      
      // Store initial volumes for all rooms in the zone
      const roomVolumes = new Map();
      for (const member of testZone.members) {
        const stateResponse = await fetch(`${defaultConfig.apiUrl}/${member.roomName}/state`);
        const state = await stateResponse.json();
        roomVolumes.set(member.id, state.volume);
      }
      
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/sayall/Room%20volume%20test/35`);
      assert.strictEqual(response.status, 200);
      
      const result = await response.json();
      assert(result.status === 'success', 'Room sayall with volume should succeed');
      
      // Wait for announcement to play
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Check if at least one room in the zone has restored its volume
      let volumeRestored = false;
      const volumePromises = [];
      
      // Create promises for all rooms but don't wait for all
      for (const [roomId, originalVolume] of roomVolumes) {
        volumePromises.push(
          eventManager.waitForVolume(roomId, originalVolume, 5000)
            .then(restored => ({ roomId, restored }))
            .catch(() => ({ roomId, restored: false }))
        );
      }
      
      // Wait for any room to restore volume
      const results = await Promise.race([
        Promise.all(volumePromises),
        new Promise(resolve => setTimeout(() => resolve([]), 8000)) // Overall timeout
      ]);
      
      if (Array.isArray(results)) {
        volumeRestored = results.some(r => r.restored);
      }
      
      assert(volumeRestored, 'At least one room in the zone should restore original volume');
    });
  });
  
  describe('State Restoration', () => {
    beforeEach(async () => {
      // Ensure we're playing before each test
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      
      if (state.playbackState !== 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${room}/play`);
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
    });
    
    it('should restore playback after announcement', async () => {
      // Capture current track
      const beforeState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateBefore = await beforeState.json();
      const trackBefore = stateBefore.currentTrack;
      
      // Make announcement
      await fetch(`${defaultConfig.apiUrl}/${room}/say/Testing%20restoration`);
      
      // Wait for announcement and restoration
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check playback restored
      const playing = await eventManager.waitForState(deviceId, 'PLAYING', 10000);
      assert(playing, 'Should restore playback');
      
      // Track should be the same (or next if it finished)
      const afterState = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const stateAfter = await afterState.json();
      assert(stateAfter.currentTrack, 'Should have current track after restoration');
    });
    
    it('should restore volume after announcement', async () => {
      // Set a specific volume
      await fetch(`${defaultConfig.apiUrl}/${room}/volume/30`);
      await eventManager.waitForVolume(deviceId, 30, 3000);
      
      // Make announcement at different volume
      await fetch(`${defaultConfig.apiUrl}/${room}/say/Volume%20test/60`);
      
      // Wait for announcement and restoration
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Volume should be restored to 30
      const restored = await eventManager.waitForVolume(deviceId, 30, 5000);
      assert(restored, 'Should restore original volume');
    });
    
    it('should handle announcement during pause', async () => {
      // First ensure we're playing
      const stateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const state = await stateResponse.json();
      
      if (state.playbackState !== 'PLAYING') {
        await fetch(`${defaultConfig.apiUrl}/${room}/play`);
        await eventManager.waitForState(deviceId, 'PLAYING', 5000);
      }
      
      // Now pause playback
      await fetch(`${defaultConfig.apiUrl}/${room}/pause`);
      await eventManager.waitForState(deviceId, 'PAUSED_PLAYBACK', 5000);
      
      // Make announcement
      await fetch(`${defaultConfig.apiUrl}/${room}/say/Testing%20during%20pause`);
      
      // Wait for announcement
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Should remain paused since we had content
      const finalStateResponse = await fetch(`${defaultConfig.apiUrl}/${room}/state`);
      const finalState = await finalStateResponse.json();
      assert.strictEqual(finalState.playbackState, 'PAUSED_PLAYBACK', 'Should remain paused');
    });
  });
  
  describe('Error Handling', () => {
    it('should handle empty text', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/`);
      assert([400, 404].includes(response.status), 'Should reject empty text');
    });
    
    it('should handle invalid room for TTS', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/InvalidRoom/say/Test`);
      assert.strictEqual(response.status, 404);
    });
    
    it('should handle TTS to grouped rooms', async () => {
      // This should work - TTS should go to the coordinator
      // Just testing that it doesn't crash
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/Group%20test`);
      assert.strictEqual(response.status, 200);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
  });
  
  describe('Language Support', () => {
    it('should handle non-English text', async () => {
      // Test with Spanish
      const response1 = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent('Hola, ¿cómo estás?')}`);
      assert.strictEqual(response1.status, 200);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Test with French
      const response2 = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent('Bonjour, comment allez-vous?')}`);
      assert.strictEqual(response2.status, 200);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
    
    it('should handle emoji and special unicode', async () => {
      const response = await fetch(`${defaultConfig.apiUrl}/${room}/say/${encodeURIComponent('Hello 👋 Testing emoji support!')}`);
      assert.strictEqual(response.status, 200);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    });
  });
});