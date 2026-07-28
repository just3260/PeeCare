<script setup lang="ts">
// Device switcher for members who own more than one device. It only presents the
// choice and emits the selected id; the store owns the actual selection and its
// single listener. When the member owns a single device the parent omits this
// control entirely.
import type { OwnedDevice } from '@/features/devices/owned-device-model'

defineProps<{
  devices: readonly OwnedDevice[]
  selectedDeviceId: string | null
}>()

const emit = defineEmits<{ (event: 'select', deviceId: string): void }>()
</script>

<template>
  <nav class="device-selector" aria-label="選擇裝置">
    <button
      v-for="deviceOption in devices"
      :key="deviceOption.deviceId"
      type="button"
      class="device-selector__option"
      :class="{ 'device-selector__option--active': deviceOption.deviceId === selectedDeviceId }"
      :aria-pressed="deviceOption.deviceId === selectedDeviceId"
      :data-test="`device-option-${deviceOption.deviceId}`"
      @click="emit('select', deviceOption.deviceId)"
    >
      {{ deviceOption.deviceId }}
    </button>
  </nav>
</template>

<style scoped>
.device-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.device-selector__option {
  padding: 6px 14px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 16px;
  background-color: var(--color-surface);
  color: var(--color-ink);
  font-size: 13px;
  cursor: pointer;
}

.device-selector__option--active {
  border-color: var(--color-brand);
  background-color: var(--color-brand);
  color: #ffffff;
}
</style>
