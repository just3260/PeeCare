<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const closeButton = ref<HTMLButtonElement | null>(null)
const overlay = ref<HTMLElement | null>(null)
const previousFocus = ref<HTMLElement | null>(null)
let previousBodyOverflow: string | null = null
let backgroundInertState = new Map<HTMLElement, boolean>()

function focusableControls(): HTMLElement[] {
  const dialog = overlay.value?.querySelector<HTMLElement>('[data-test="wifi-guide-dialog"]')
  if (!dialog) return []

  return [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
}

function setBackgroundInert(): void {
  const overlayElement = overlay.value
  if (!overlayElement) return

  backgroundInertState = new Map()
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child === overlayElement) continue
    backgroundInertState.set(child, child.hasAttribute('inert'))
    child.setAttribute('inert', '')
  }
}

function restoreBackground(): void {
  for (const [element, wasInert] of backgroundInertState) {
    if (!wasInert) element.removeAttribute('inert')
  }
  backgroundInertState.clear()
}

function lockBackground(): void {
  if (previousBodyOverflow === null) {
    previousBodyOverflow = document.body.style.overflow
  }
  document.body.style.overflow = 'hidden'
}

function restoreBackgroundScroll(): void {
  if (previousBodyOverflow === null) return
  document.body.style.overflow = previousBodyOverflow
  previousBodyOverflow = null
}

function activateDialog(): void {
  const activeElement = document.activeElement
  previousFocus.value = activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null
  lockBackground()
  setBackgroundInert()
  closeButton.value?.focus()
}

function deactivateDialog(restoreFocus = true): void {
  restoreBackground()
  restoreBackgroundScroll()

  const target = previousFocus.value
  previousFocus.value = null
  if (restoreFocus && target?.isConnected) {
    target.focus()
  }
}

function requestClose(): void {
  emit('close')
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (!props.open) return

  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose()
    return
  }

  if (event.key !== 'Tab') return
  const controls = focusableControls()
  if (controls.length === 0) {
    event.preventDefault()
    return
  }

  const first = controls[0]
  const last = controls[controls.length - 1]
  const activeElement = document.activeElement

  if (event.shiftKey && (activeElement === first || !controls.includes(activeElement as HTMLElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (activeElement === last || !controls.includes(activeElement as HTMLElement))) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      activateDialog()
    } else {
      deactivateDialog()
    }
  },
  { flush: 'post' },
)

onMounted(() => {
  document.addEventListener('keydown', handleDocumentKeydown)
  if (props.open) activateDialog()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown)
  deactivateDialog(false)
})

const steps = [
  {
    icon: '⚙️',
    title: '進入設定模式',
    description: '依照 PeeCare 裝置上的操作提示，讓裝置進入設定模式。',
  },
  {
    icon: '📶',
    title: '連接臨時網路',
    description: '開啟手機的 Wi-Fi 設定，連上 PeeCare 提供的臨時 Wi-Fi。',
  },
  {
    icon: '📱',
    title: '等待設定頁',
    description: '保持手機連線，等待硬體設定頁開啟。',
  },
  {
    icon: '🔐',
    title: '選擇家中網路',
    description: '在設定頁選擇目標 Wi-Fi，並輸入該網路的密碼。',
  },
  {
    icon: '🔄',
    title: '等候裝置切換',
    description: '等待硬體斷開臨時網路，並切換到剛才選擇的 Wi-Fi。',
  },
  {
    icon: '✓',
    title: '返回 PeeCare',
    description: '讓手機恢復一般網路連線，接著返回 Web App。',
  },
] as const
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="overlay"
      class="wifi-guide-dialog__overlay"
      data-test="wifi-guide-overlay"
      @click.self="requestClose"
    >
      <section
        class="wifi-guide-dialog__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wifi-connection-guide-title"
        data-test="wifi-guide-dialog"
      >
        <div class="wifi-guide-dialog__surface" data-test="wifi-guide-surface">
          <header class="wifi-guide-dialog__header" data-test="wifi-guide-header">
            <div>
              <p class="wifi-guide-dialog__eyebrow">首次連線</p>
              <h2
                id="wifi-connection-guide-title"
                class="wifi-guide-dialog__title"
                data-test="wifi-guide-title"
              >Wi-Fi 連線說明</h2>
            </div>
            <button
              ref="closeButton"
              type="button"
              class="wifi-guide-dialog__close"
              aria-label="關閉 Wi-Fi 連線說明"
              data-test="wifi-guide-close"
              @click="requestClose"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div class="wifi-guide-dialog__scroll-region" data-test="wifi-guide-scroll-region">
            <p class="wifi-guide-dialog__intro">
              依照以下步驟，讓 PeeCare 裝置與家中的網路建立連線。
            </p>

            <ol class="wifi-guide-dialog__steps">
              <li
                v-for="(step, index) in steps"
                :key="step.title"
                class="wifi-guide-dialog__step"
                data-test="wifi-guide-step"
              >
                <span
                  class="wifi-guide-dialog__step-marker"
                  data-test="wifi-guide-step-marker"
                  aria-hidden="true"
                >
                  <span class="wifi-guide-dialog__step-icon">{{ step.icon }}</span>
                  <span class="wifi-guide-dialog__step-number">{{ index + 1 }}</span>
                </span>
                <span class="wifi-guide-dialog__step-copy">
                  <strong>{{ step.title }}</strong>
                  <span>{{ step.description }}</span>
                </span>
              </li>
            </ol>
          </div>

          <footer class="wifi-guide-dialog__footer" data-test="wifi-guide-footer">
            <button
              type="button"
              class="wifi-guide-dialog__acknowledge"
              data-test="wifi-guide-acknowledge"
              @click="requestClose"
            >
              我知道了
            </button>
          </footer>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.wifi-guide-dialog__overlay {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding:
    max(12px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  background: rgba(30, 26, 20, 0.56);
  backdrop-filter: blur(4px);
}

.wifi-guide-dialog__dialog {
  width: min(100%, 620px);
  max-height: min(820px, calc(100dvh - 32px));
}

.wifi-guide-dialog__surface {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: 100%;
  max-height: inherit;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-brand-strong) 18%, transparent);
  border-radius: 28px;
  background: var(--color-surface, #fff);
  box-shadow: 0 24px 64px rgba(37, 28, 18, 0.22);
}

.wifi-guide-dialog__header,
.wifi-guide-dialog__footer {
  position: relative;
  z-index: 1;
  background: var(--color-surface, #fff);
}

.wifi-guide-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 22px 16px;
  border-bottom: 1px solid var(--color-border, #ece8e2);
}

.wifi-guide-dialog__eyebrow {
  margin: 0 0 4px;
  color: var(--color-brand-strong, #8a5a24);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.wifi-guide-dialog__title {
  margin: 0;
  color: var(--color-ink, #28231e);
  font-size: clamp(22px, 5vw, 28px);
  line-height: 1.2;
}

.wifi-guide-dialog__close {
  display: grid;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--color-background, #f5f2ed);
  color: var(--color-ink, #28231e);
  font: inherit;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
}

.wifi-guide-dialog__close:focus-visible,
.wifi-guide-dialog__acknowledge:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-brand-strong) 38%, transparent);
  outline-offset: 3px;
}

.wifi-guide-dialog__scroll-region {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 22px 24px;
}

.wifi-guide-dialog__intro {
  margin: 0 0 18px;
  color: var(--color-muted, #71685f);
  font-size: 14px;
  line-height: 1.65;
}

.wifi-guide-dialog__steps {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wifi-guide-dialog__step {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--color-border, #ece8e2);
  border-radius: 18px;
  background: color-mix(in srgb, var(--color-brand-soft, #f6eadc) 42%, white);
}

.wifi-guide-dialog__step-marker {
  position: relative;
  display: grid;
  width: 56px;
  height: 56px;
  place-items: center;
  border-radius: 18px;
  background: var(--color-surface, #fff);
  box-shadow: 0 6px 18px rgba(65, 47, 28, 0.08);
}

.wifi-guide-dialog__step-icon {
  font-size: 23px;
}

.wifi-guide-dialog__step-number {
  position: absolute;
  right: -4px;
  bottom: -4px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 2px solid var(--color-surface, #fff);
  border-radius: 50%;
  background: var(--color-brand-strong, #8a5a24);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}

.wifi-guide-dialog__step-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  color: var(--color-muted, #71685f);
  font-size: 14px;
  line-height: 1.55;
}

.wifi-guide-dialog__step-copy strong {
  color: var(--color-ink, #28231e);
  font-size: 15px;
}

.wifi-guide-dialog__footer {
  padding: 16px 22px max(16px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--color-border, #ece8e2);
}

.wifi-guide-dialog__acknowledge {
  width: 100%;
  min-height: 48px;
  border: 0;
  border-radius: 16px;
  background: var(--color-brand-strong, #8a5a24);
  color: #fff;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 520px) {
  .wifi-guide-dialog__overlay {
    place-items: stretch;
    padding:
      max(8px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
  }

  .wifi-guide-dialog__dialog {
    width: 100%;
    max-height: none;
  }

  .wifi-guide-dialog__surface {
    width: 100%;
    height: 100%;
    max-height: none;
    border-radius: 22px;
  }

  .wifi-guide-dialog__header,
  .wifi-guide-dialog__scroll-region,
  .wifi-guide-dialog__footer {
    padding-right: 16px;
    padding-left: 16px;
  }
}
</style>
