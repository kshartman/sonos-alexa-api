# v1.3.0 Release Notes (DRAFT)

## 🎯 Device Information API

This release adds comprehensive device information endpoints to provide detailed hardware and configuration data.

### New Features

#### Device Information Endpoints
- **GET /devices** - List all devices with model, IP, and stereo/surround configuration
- **GET /devices/id/{deviceId}** - Get specific device by ID (with or without uuid: prefix)
- **GET /devices/room/{roomName}** - Get all devices in a specific room

#### Device Details Include:
- Room name
- Device ID (UUID)
- Model name (e.g., "Sonos Era 100", "Sonos Era 300", "Sonos Connect")
- IP address
- Stereo/surround pairing information:
  - Role: left, right, center, surround-left, surround-right, subwoofer, height
  - Group ID for paired devices

### Improvements

#### Model Name Resolution
- Fixed "Unknown" model names appearing for devices discovered via topology
- Model information now properly updates when devices are discovered via SSDP
- All devices now display their correct hardware model

#### Stereo Pair Detection
- Accurate left/right channel detection for stereo pairs
- Support for all Sonos speaker roles (stereo, surround, Atmos)
- Proper parsing of channelMapSet data from topology

### Example Response

```json
[
  {
    "room": "BedroomSpeakers",
    "name": "BedroomSpeakers",
    "id": "uuid:RINCON_F0F6C1AF852C01400",
    "model": "Sonos Era 100",
    "ip": "192.168.4.76",
    "paired": {
      "role": "left",
      "groupId": "BedroomSpeakers:stereopair"
    }
  },
  {
    "room": "BedroomSpeakers",
    "name": "BedroomSpeakers", 
    "id": "uuid:RINCON_C4387597EEE001400",
    "model": "Sonos Era 100",
    "ip": "192.168.4.64",
    "paired": {
      "role": "right",
      "groupId": "BedroomSpeakers:stereopair"
    }
  }
]
```

### Technical Details

- Device discovery now updates existing device records with proper model information
- Added comprehensive channel role mapping for all Sonos configurations
- TypeScript improvements for better type safety in device handling

### Coming in Future Releases

- WebSocket support for real-time device state updates
- Enhanced error handling and retry logic
- Additional device capabilities and service information

---

*Note: This is a draft. Final release notes will be updated before v1.3.0 release.*