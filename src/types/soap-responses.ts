/**
 * Type definitions for SOAP responses from Sonos devices
 * These interfaces represent the parsed XML responses from various SOAP services
 */

// Common types
export interface UPnPError {
  errorCode: string;
  errorDescription?: string;
}

export interface SOAPFault {
  faultcode?: string;
  faultstring?: string;
  detail?: {
    UPnPError?: UPnPError;
  };
}

// ContentDirectory Service Responses
export interface BrowseResponse {
  Result: string; // DIDL-Lite XML string
  NumberReturned: string;
  TotalMatches: string;
  UpdateID?: string;
}

export interface SearchResponse {
  Result: string; // DIDL-Lite XML string
  NumberReturned: string;
  TotalMatches: string;
  UpdateID?: string;
}

export interface CreateObjectResponse {
  ObjectID: string;
  Result: string; // DIDL-Lite XML string
}

export interface DestroyObjectResponse {
  // Empty response on success
}

// AVTransport Service Responses
export interface TransportInfo {
  CurrentTransportState: 'PLAYING' | 'PAUSED_PLAYBACK' | 'STOPPED' | 'TRANSITIONING';
  CurrentTransportStatus: string;
  CurrentSpeed: string;
}

export interface PositionInfo {
  Track: string;
  TrackDuration: string;
  TrackMetaData: string; // DIDL-Lite XML string
  TrackURI: string;
  RelTime: string;
  AbsTime: string;
  RelCount: string;
  AbsCount: string;
}

export interface MediaInfo {
  NrTracks: string;
  MediaDuration: string;
  CurrentURI: string;
  CurrentURIMetaData: string; // DIDL-Lite XML string
  NextURI?: string;
  NextURIMetaData?: string;
  PlayMedium: string;
  RecordMedium: string;
  WriteStatus: string;
}

export interface TransportSettings {
  PlayMode: 'NORMAL' | 'REPEAT_ALL' | 'REPEAT_ONE' | 'SHUFFLE' | 'SHUFFLE_NOREPEAT';
  RecQualityMode?: string;
}

export interface CrossfadeMode {
  CrossfadeMode: string; // "0" or "1"
}

export interface AddURIToQueueResponse {
  FirstTrackNumberEnqueued: string;
  NumTracksAdded: string;
  NewQueueLength: string;
  NewUpdateID?: string;
}

export interface AddMultipleURIsToQueueResponse {
  FirstTrackNumberEnqueued: string;
  NumTracksAdded: string;
  NewQueueLength: string;
  NewUpdateID?: string;
}

export interface RemoveTrackRangeFromQueueResponse {
  NewUpdateID: string;
}

export interface ReorderTracksInQueueResponse {
  // Empty response on success
}

export interface SaveQueueResponse {
  AssignedObjectID: string;
}

// RenderingControl Service Responses
export interface VolumeResponse {
  CurrentVolume: string;
}

export interface MuteResponse {
  CurrentMute: string; // "0" or "1"
}

export interface BassResponse {
  CurrentBass: string;
}

export interface TrebleResponse {
  CurrentTreble: string;
}

export interface LoudnessResponse {
  CurrentLoudness: string; // "0" or "1"
}

// MusicServices Responses
export interface ListAvailableServicesResponse {
  AvailableServiceDescriptorList: string; // XML string containing service list
  AvailableServiceTypeList?: string;
  AvailableServiceListVersion?: string;
}

// GroupManagement Service Responses
export interface AddMembersToGroupResponse {
  CurrentTransportSettings: string;
  GroupUUIDJoined?: string;
  ResetVolumeAfter?: boolean;
  VolumeAVTransportURI?: string;
}

export interface RemoveMembersFromGroupResponse {
  // Empty response on success
}

// Type guards
export function isSOAPFault(response: unknown): response is SOAPFault {
  return (
    typeof response === 'object' &&
    response !== null &&
    ('faultcode' in response || 'faultstring' in response)
  );
}

export function hasUPnPError(response: unknown): response is { detail: { UPnPError: UPnPError } } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'detail' in response &&
    typeof response.detail === 'object' &&
    response.detail !== null &&
    'UPnPError' in response.detail
  );
}