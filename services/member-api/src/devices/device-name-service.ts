import { normalizeCustomName } from './custom-name.js';
import type {
  DeviceNameRepository,
  PersistedDeviceName,
} from '../firestore/device-name-repository.js';

export interface UpdateDisplayNameCommand {
  readonly memberUid: string;
  readonly deviceId: string;
  readonly customName: string | null;
}

export interface DeviceDisplayName extends PersistedDeviceName {
  readonly displayName: string;
}

export class DeviceNameService {
  constructor(private readonly repository: DeviceNameRepository) {}

  async updateDisplayName(command: UpdateDisplayNameCommand): Promise<DeviceDisplayName> {
    const persisted = await this.repository.updateOwnedDeviceName({
      memberUid: command.memberUid,
      deviceId: command.deviceId,
      customName: normalizeCustomName(command.customName),
    });

    return {
      ...persisted,
      displayName: persisted.customName ?? persisted.deviceId,
    };
  }
}
