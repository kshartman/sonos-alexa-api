#!/usr/bin/env tsx
/**
 * Analyzes Sonos system infrastructure to generate comprehensive reports about rooms and devices
 * Usage: tsx analyze-home-infrastructure.ts [api-url] [output-dir]
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface Device {
  id: string;
  model: string;
  room: string;
  name: string;
  ip: string;
  paired?: {
    role: string;
    groupId: string;
  };
}

interface Zone {
  id: string;
  coordinator: string;
  members: Array<{
    id: string;
    roomName: string;
    isCoordinator: boolean;
  }>;
}

interface DeviceState {
  playbackState: string;
  volume: number;
  mute: boolean;
  currentTrack: any;
}

const API_URL = process.argv[2] || 'http://localhost:5005';
const OUTPUT_DIR = process.argv[3] || 'homes/default';

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function generateInfrastructureAnalysis(): Promise<string> {
  let output = '# Sonos Infrastructure Analysis\n\n';
  output += `Generated: ${new Date().toISOString()}\n`;
  output += `API: ${API_URL}\n\n`;
  
  // Fetch devices
  console.log('Fetching devices...');
  const devices: Device[] = await fetchWithRetry(`${API_URL}/devices`);
  
  // Fetch zones
  console.log('Fetching zones...');
  const zones: Zone[] = await fetchWithRetry(`${API_URL}/zones`);
  
  // Fetch state for each device
  console.log('Fetching device states...');
  const deviceStates = new Map<string, DeviceState>();
  for (const device of devices) {
    if (!device.room) {
      console.warn(`Skipping device ${device.id} - no room name`);
      continue;
    }
    try {
      const state = await fetchWithRetry(`${API_URL}/${device.room}/state`);
      deviceStates.set(device.id, state);
    } catch (error) {
      console.warn(`Failed to fetch state for ${device.room}:`, error);
    }
  }
  
  // Summary
  output += '## System Summary\n\n';
  output += `- **Total Devices**: ${devices.length}\n`;
  output += `- **Total Zones**: ${zones.length}\n`;
  output += `- **Stereo Pairs**: ${devices.filter(d => d.paired).length / 2}\n`;
  
  // Count devices by model
  const modelCounts = new Map<string, number>();
  devices.forEach(device => {
    const count = modelCounts.get(device.model) || 0;
    modelCounts.set(device.model, count + 1);
  });
  
  output += `- **Device Models**: ${modelCounts.size}\n\n`;
  
  // Model breakdown
  output += '### Device Models\n\n';
  const sortedModels = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]);
  sortedModels.forEach(([model, count]) => {
    output += `- ${model}: ${count} device${count > 1 ? 's' : ''}\n`;
  });
  output += '\n';
  
  // Zones breakdown
  output += '## Zones/Groups\n\n';
  zones.forEach((zone, index) => {
    output += `### Zone ${index + 1}\n`;
    output += `- **Coordinator**: ${zone.coordinator}\n`;
    output += `- **Members**: ${zone.members.length}\n`;
    zone.members.forEach(member => {
      output += `  - ${member.roomName}${member.isCoordinator ? ' (coordinator)' : ''}\n`;
    });
    output += '\n';
  });
  
  // Detailed device information
  output += '## Device Details\n\n';
  
  // Sort devices by room name, filtering out devices without room names
  const sortedDevices = [...devices]
    .filter(d => d.room)
    .sort((a, b) => a.room.localeCompare(b.room));
  
  sortedDevices.forEach(device => {
    output += `### ${device.room}\n`;
    output += `- **Model**: ${device.model}\n`;
    output += `- **ID**: ${device.id}\n`;
    output += `- **IP Address**: ${device.ip}\n`;
    
    if (device.paired) {
      output += `- **Stereo Pair**: ${device.paired.role} speaker\n`;
    }
    
    const state = deviceStates.get(device.id);
    if (state) {
      output += `- **Current State**:\n`;
      output += `  - Playback: ${state.playbackState}\n`;
      output += `  - Volume: ${state.volume}\n`;
      output += `  - Mute: ${state.mute ? 'Yes' : 'No'}\n`;
      if (state.currentTrack) {
        output += `  - Now Playing: ${state.currentTrack.title || 'Unknown'}\n`;
      }
    }
    
    output += '\n';
  });
  
  // Network information
  output += '## Network Analysis\n\n';
  
  // Extract subnet information
  const subnets = new Map<string, Device[]>();
  devices.forEach(device => {
    const subnet = device.ip.substring(0, device.ip.lastIndexOf('.'));
    const devicesOnSubnet = subnets.get(subnet) || [];
    devicesOnSubnet.push(device);
    subnets.set(subnet, devicesOnSubnet);
  });
  
  output += `### Subnet Distribution\n\n`;
  subnets.forEach((devicesOnSubnet, subnet) => {
    output += `- **${subnet}.0/24**: ${devicesOnSubnet.length} devices\n`;
    devicesOnSubnet.forEach(device => {
      output += `  - ${device.room} (${device.ip})\n`;
    });
  });
  output += '\n';
  
  // Capabilities analysis
  output += '## Capabilities Analysis\n\n';
  
  const stereoPairs: string[] = [];
  const surroundSystems: string[] = [];
  const portableDevices: string[] = [];
  const stationary: string[] = [];
  
  devices.forEach(device => {
    if (!device.room) return; // Skip devices without room names
    
    const modelLower = device.model.toLowerCase();
    if (modelLower.includes('roam') || modelLower.includes('move')) {
      portableDevices.push(device.room);
    } else {
      stationary.push(device.room);
    }
    
    if (device.paired) {
      const pairName = device.paired.groupId.replace(':stereopair', '');
      if (!stereoPairs.includes(pairName)) {
        stereoPairs.push(pairName);
      }
    }
  });
  
  output += `### Device Categories\n\n`;
  output += `- **Portable Devices**: ${portableDevices.length}\n`;
  if (portableDevices.length > 0) {
    portableDevices.forEach(device => {
      output += `  - ${device}\n`;
    });
  }
  
  output += `- **Stationary Devices**: ${stationary.length}\n`;
  output += `- **Stereo Pairs**: ${stereoPairs.length}\n`;
  if (stereoPairs.length > 0) {
    stereoPairs.forEach(pair => {
      output += `  - ${pair}\n`;
    });
  }
  
  output += '\n## Raw Device Data\n\n';
  output += '```json\n';
  output += JSON.stringify(devices, null, 2);
  output += '\n```\n';
  
  return output;
}

async function generateDeviceMatrix(): Promise<string> {
  let output = '# Device Compatibility Matrix\n\n';
  output += `Generated: ${new Date().toISOString()}\n\n`;
  
  const devices: Device[] = await fetchWithRetry(`${API_URL}/devices`);
  
  // Group devices by model
  const devicesByModel = new Map<string, Device[]>();
  devices.forEach(device => {
    const devicesForModel = devicesByModel.get(device.model) || [];
    devicesForModel.push(device);
    devicesByModel.set(device.model, devicesForModel);
  });
  
  output += '## Supported Features by Model\n\n';
  output += '| Model | Count | Line-In | AirPlay | Voice | Portable | Notes |\n';
  output += '|-------|-------|---------|---------|-------|----------|-------|\n';
  
  const modelFeatures: Record<string, any> = {
    // Models with voice support
    'Sonos One': { lineIn: false, airPlay: true, voice: true, portable: false, notes: 'Smart speaker with Alexa/Google' },
    'Sonos Beam': { lineIn: false, airPlay: true, voice: true, portable: false, notes: 'Soundbar with Alexa/Google' },
    'Sonos Arc': { lineIn: false, airPlay: true, voice: true, portable: false, notes: 'Premium soundbar with voice' },
    'Sonos Era 100': { lineIn: true, airPlay: true, voice: true, portable: false, notes: 'Era speaker with Alexa only' },
    'Sonos Era 300': { lineIn: true, airPlay: true, voice: true, portable: false, notes: 'Spatial audio with Alexa only' },
    'Sonos Move': { lineIn: false, airPlay: true, voice: true, portable: true, notes: 'Portable with Alexa/Google' },
    'Sonos Move 2': { lineIn: true, airPlay: true, voice: true, portable: true, notes: 'Move 2 with Alexa only' },
    'Sonos Roam': { lineIn: false, airPlay: true, voice: true, portable: true, notes: 'Ultra-portable with voice' },
    
    // Models without voice support (mic-less)
    'Sonos One SL': { lineIn: false, airPlay: true, voice: false, portable: false, notes: 'One without microphones' },
    'Sonos Roam SL': { lineIn: false, airPlay: true, voice: false, portable: true, notes: 'Roam without microphones' },
    'Sonos Ray': { lineIn: false, airPlay: true, voice: false, portable: false, notes: 'Entry soundbar (no mics)' },
    'Sonos Five': { lineIn: true, airPlay: true, voice: false, portable: false, notes: 'Premium speaker (no mics)' },
    'Sonos Port': { lineIn: true, airPlay: true, voice: false, portable: false, notes: 'Streaming component' },
    'Sonos Amp': { lineIn: true, airPlay: true, voice: false, portable: false, notes: 'Amplifier component' },
    
    // Legacy models (no voice support)
    'Sonos PLAY:1': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Legacy compact speaker' },
    'Sonos PLAY:3': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Legacy mid-size speaker' },
    'Sonos PLAY:5': { lineIn: true, airPlay: false, voice: false, portable: false, notes: 'Legacy premium speaker' },
    'Sonos Playbar': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Legacy soundbar' },
    'Sonos Playbase': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Legacy TV base' },
    'Sonos Connect': { lineIn: true, airPlay: false, voice: false, portable: false, notes: 'Legacy streaming device' },
    'Sonos Connect:Amp': { lineIn: true, airPlay: false, voice: false, portable: false, notes: 'Legacy amplifier' },
    
    // Other models
    'Sonos Sub': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Subwoofer' },
    'Sonos Sub Mini': { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Compact subwoofer' },
    'SYMFONISK': { lineIn: false, airPlay: true, voice: false, portable: false, notes: 'IKEA collaboration' }
  };
  
  Array.from(devicesByModel.entries()).sort().forEach(([model, devicesForModel]) => {
    const features = modelFeatures[model] || { lineIn: false, airPlay: false, voice: false, portable: false, notes: 'Unknown model' };
    output += `| ${model} | ${devicesForModel.length} | ${features.lineIn ? '✓' : '✗'} | ${features.airPlay ? '✓' : '✗'} | ${features.voice ? '✓' : '✗'} | ${features.portable ? '✓' : '✗'} | ${features.notes} |\n`;
  });
  
  output += '\n## Room Capabilities\n\n';
  output += '| Room | Model | Line-In | Stereo Pair | Group Member |\n';
  output += '|------|-------|---------|-------------|---------------|\n';
  
  const zones: Zone[] = await fetchWithRetry(`${API_URL}/zones`);
  const groupedDevices = new Set<string>();
  zones.forEach(zone => {
    if (zone.members.length > 1) {
      zone.members.forEach(member => groupedDevices.add(member.id));
    }
  });
  
  devices
    .filter(d => d.room)
    .sort((a, b) => a.room.localeCompare(b.room))
    .forEach(device => {
      const features = modelFeatures[device.model] || { lineIn: false };
      const isGrouped = groupedDevices.has(device.id);
      output += `| ${device.room} | ${device.model} | ${features.lineIn ? '✓' : '✗'} | ${device.paired ? '✓' : '✗'} | ${isGrouped ? '✓' : '✗'} |\n`;
    });
  
  return output;
}

async function main() {
  try {
    // Create output directory
    mkdirSync(OUTPUT_DIR, { recursive: true });
    
    // Generate infrastructure analysis
    console.log('Generating infrastructure analysis...');
    const infrastructureReport = await generateInfrastructureAnalysis();
    writeFileSync(join(OUTPUT_DIR, 'infrastructure-analysis.md'), infrastructureReport);
    
    // Generate device matrix
    console.log('Generating device compatibility matrix...');
    const matrixReport = await generateDeviceMatrix();
    writeFileSync(join(OUTPUT_DIR, 'device-matrix.md'), matrixReport);
    
    console.log(`\nReports generated successfully in ${OUTPUT_DIR}/`);
    console.log('- infrastructure-analysis.md');
    console.log('- device-matrix.md');
    
  } catch (error) {
    console.error('Error generating reports:', error);
    process.exit(1);
  }
}

main();