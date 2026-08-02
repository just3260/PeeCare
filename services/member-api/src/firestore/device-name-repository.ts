import { FieldValue, type Firestore } from '@google-cloud/firestore';

import type { CustomNameNormalization } from '../devices/custom-name.js';
import { PersistenceUnavailableError } from '../http/errors.js';

export interface PersistDeviceNameCommand {
  readonly memberUid: string;
  readonly deviceId: string;
  readonly customName: CustomNameNormalization;
}

export interface PersistedDeviceName {
  readonly deviceId: string;
  readonly customName: string | null;
}

export interface DeviceNameRepository {
  updateOwnedDeviceName(command: PersistDeviceNameCommand): Promise<PersistedDeviceName>;
}

export class DeviceNotFoundError extends Error {
  readonly code = 'device_not_found' as const;

  constructor() {
    super('Device not found.');
    this.name = 'DeviceNotFoundError';
    Object.setPrototypeOf(this, DeviceNotFoundError.prototype);
  }
}

export class FirestoreDeviceNameRepository implements DeviceNameRepository {
  constructor(private readonly firestore: Firestore) {}

  async updateOwnedDeviceName(command: PersistDeviceNameCommand): Promise<PersistedDeviceName> {
    const deviceReference = this.firestore.doc(`devices/${command.deviceId}`);

    try {
      return await this.firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(deviceReference);
        const ownerUid = snapshot.exists ? snapshot.get('ownerUid') : undefined;
        if (typeof ownerUid !== 'string' || ownerUid.length === 0 || ownerUid !== command.memberUid) {
          throw new DeviceNotFoundError();
        }

        const customName = command.customName.kind === 'set' ? command.customName.value : null;
        transaction.update(deviceReference, {
          customName:
            command.customName.kind === 'set' ? command.customName.value : FieldValue.delete(),
        });

        return { deviceId: command.deviceId, customName };
      });
    } catch (error) {
      if (error instanceof DeviceNotFoundError) {
        throw error;
      }
      const code = (error as { code?: unknown } | null)?.code;
      if (
        [4, 8, 10, 13, 14, 'DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'ABORTED', 'INTERNAL', 'UNAVAILABLE'].includes(
          code as never,
        )
      ) {
        throw new PersistenceUnavailableError();
      }
      throw error;
    }
  }
}
