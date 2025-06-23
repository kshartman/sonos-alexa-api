import type { RouteParams } from '../types/sonos.js';

export function requireParam(params: RouteParams, paramName: string): string {
  const value = params[paramName];
  if (!value) {
    throw { status: 400, message: `${paramName} parameter is required` };
  }
  return value;
}

export function requireNumberParam(params: RouteParams, paramName: string): number {
  const value = requireParam(params, paramName);
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw { status: 400, message: `${paramName} must be a valid number` };
  }
  return num;
}

export function requireVolumeParam(params: RouteParams, paramName: string): number {
  const volume = requireNumberParam(params, paramName);
  if (volume < 0 || volume > 100) {
    throw { status: 400, message: `${paramName} must be between 0 and 100` };
  }
  return volume;
}