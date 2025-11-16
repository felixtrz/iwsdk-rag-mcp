/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export const CameraFacing = {
  Back: 'back',
  Front: 'front',
  Unknown: 'unknown',
} as const;

export type CameraFacingType = (typeof CameraFacing)[keyof typeof CameraFacing];

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  facing: CameraFacingType;
}

/**
 * Camera stream state lifecycle
 */
export const CameraState = {
  Inactive: 'inactive', // Not started
  Starting: 'starting', // Async initialization in progress
  Active: 'active', // Stream running
  Error: 'error', // Failed to start
} as const;

export type CameraStateType = (typeof CameraState)[keyof typeof CameraState];
