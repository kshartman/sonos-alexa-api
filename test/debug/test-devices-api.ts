#!/usr/bin/env tsx

async function testDevicesApi() {
  console.log('Testing new /devices API endpoints...\n');
  
  try {
    // Test /devices
    console.log('1. Testing GET /devices');
    const allDevices = await fetch('http://localhost:5005/devices');
    const devices = await allDevices.json();
    console.log(`Found ${devices.length} devices:`);
    devices.forEach((device: any) => {
      console.log(`  - ${device.room} (${device.model}) - ${device.id}`);
      if (device.paired) {
        console.log(`    Stereo pair: ${device.paired.role} in group ${device.paired.groupId}`);
      }
    });
    
    // Test /devices/id/{id}
    if (devices.length > 0) {
      console.log('\n2. Testing GET /devices/id/{id}');
      const firstDevice = devices[0];
      const deviceId = firstDevice.id.replace('uuid:', '');
      const deviceById = await fetch(`http://localhost:5005/devices/id/${deviceId}`);
      const device = await deviceById.json();
      console.log('Device details:', JSON.stringify(device, null, 2));
    }
    
    // Test /devices/room/{room}
    if (devices.length > 0) {
      console.log('\n3. Testing GET /devices/room/{room}');
      const roomName = devices[0].room;
      const devicesInRoom = await fetch(`http://localhost:5005/devices/room/${encodeURIComponent(roomName)}`);
      const roomDevices = await devicesInRoom.json();
      console.log(`Devices in ${roomName}:`, JSON.stringify(roomDevices, null, 2));
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testDevicesApi().catch(console.error);