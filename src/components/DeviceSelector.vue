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

function handleChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  emit('select', target.value)
}
</script>

<template>
  <div class="device-selector">
    <label class="device-selector__label" for="device-select">裝置</label>
    <div class="device-selector__field">
      <select
        id="device-select"
        class="device-selector__select"
        data-test="device-select"
        :value="selectedDeviceId ?? ''"
        aria-label="選擇裝置"
        @change="handleChange"
      >
        <option
          v-for="deviceOption in devices"
          :key="deviceOption.deviceId"
          :value="deviceOption.deviceId"
        >
          {{ deviceOption.deviceId }}
        </option>
      </select>
      <span class="device-selector__chevron" aria-hidden="true">▾</span>
    </div>
  </div>
</template>

<style scoped>
.device-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.device-selector__label {
  font-size: 12px;
  color: var(--color-muted);
}

.device-selector__field {
  position: relative;
  display: flex;
  align-items: center;
}

.device-selector__select {
  width: 100%;
  padding: 10px 36px 10px 14px;
  border: 1px solid var(--color-border, #d0d0d0);
  border-radius: 12px;
  background-color: var(--color-surface);
  color: var(--color-ink);
  font-size: 14px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}

.device-selector__select:focus-visible {
  outline: none;
  border-color: var(--color-brand);
}

.device-selector__chevron {
  position: absolute;
  right: 14px;
  color: var(--color-muted);
  font-size: 12px;
  pointer-events: none;
}
</style>
