/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/index.js';
import { CameraFacing, CameraState } from './types.js';

/**
 * CameraSource - Component for accessing device cameras
 * Provides VideoTexture for rendering and HTMLVideoElement for advanced use
 */
export const CameraSource = createComponent(
  'CameraSource',
  {
    // Input (set by user)
    deviceId: { type: Types.String, default: '' }, // Empty = auto-select based on facing
    facing: {
      type: Types.Enum,
      enum: CameraFacing,
      default: CameraFacing.Unknown,
    }, // 'front' | 'back' | 'unknown' - used for auto-selection (unknown = any camera)
    width: { type: Types.Int16, default: 1920 },
    height: { type: Types.Int16, default: 1080 },
    frameRate: { type: Types.Int16, default: 30 },

    // Output (managed by system, read-only for users)
    state: {
      type: Types.Enum,
      enum: CameraState,
      default: CameraState.Inactive,
    }, // 'inactive' | 'starting' | 'active' | 'error'
    texture: { type: Types.Object, default: null }, // VideoTexture
    videoElement: { type: Types.Object, default: null }, // HTMLVideoElement (for advanced use)
    stream: { type: Types.Object, default: null }, // MediaStream (internal)
  },
  'Camera video source with texture output',
);
