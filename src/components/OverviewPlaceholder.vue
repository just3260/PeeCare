<script setup lang="ts">
// Neutral overview placeholder. It intentionally accepts no business data
// props — a later overview change will replace it with a real view model.
// Until a device data source exists, every value stays neutral: no urine
// volume, comparison claim, Wi-Fi health, or online status is shown.
</script>

<template>
  <section class="overview" aria-label="首頁總覽">
    <div class="overview__summary">
      <p class="overview__eyebrow">首頁總覽</p>
      <h2 class="overview__heading">尚無裝置資料</h2>
      <p class="overview__status">目前狀態：待校正，尚未回報。</p>
      <div class="overview__badges">
        <span class="overview__badge">今日尿量 —</span>
        <span class="overview__badge">最近一次 —</span>
      </div>
    </div>

    <div class="overview__section-header">
      <h3 class="overview__section-title">即時卡片</h3>
      <span class="overview__section-hint">待裝置接入後顯示</span>
    </div>

    <div class="overview__grid">
      <article class="metric-card">
        <p class="metric-card__label">今日尿量</p>
        <p class="metric-card__value">—<span class="metric-card__unit">mL</span></p>
        <p class="metric-card__footer">待校正</p>
      </article>
      <article class="metric-card">
        <p class="metric-card__label">今日次數</p>
        <p class="metric-card__value">—<span class="metric-card__unit">次</span></p>
        <p class="metric-card__footer">待校正</p>
      </article>
      <article class="metric-card">
        <p class="metric-card__label">最近一次</p>
        <p class="metric-card__value">—<span class="metric-card__unit">mL</span></p>
        <p class="metric-card__footer">尚未回報</p>
      </article>
      <article class="metric-card">
        <p class="metric-card__label">目前狀態</p>
        <p class="metric-card__value metric-card__value--state">待校正</p>
        <p class="metric-card__footer">尚無裝置資料</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.overview {
  display: block;
}

.overview__summary {
  margin-bottom: 24px;
  padding: 24px;
  border-radius: 24px;
  background-color: var(--color-brand);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(22, 101, 84, 0.2);
}

.overview__eyebrow {
  margin-bottom: 8px;
  font-size: 14px;
  opacity: 0.9;
}

.overview__heading {
  margin-bottom: 12px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.3;
}

.overview__status {
  margin-bottom: 20px;
  font-size: 13px;
  opacity: 0.9;
}

.overview__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.overview__badge {
  padding: 6px 12px;
  border-radius: 16px;
  background-color: rgba(255, 255, 255, 0.2);
  font-size: 13px;
}

.overview__section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 16px;
}

.overview__section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-ink);
}

.overview__section-hint {
  font-size: 13px;
  color: var(--color-muted);
}

.overview__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 20px;
  border-radius: 20px;
  background-color: var(--color-surface);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.03);
}

.metric-card__label {
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--color-muted);
}

.metric-card__value {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 16px;
  font-size: 32px;
  font-weight: 700;
  color: var(--color-ink);
}

.metric-card__value--state {
  font-size: 24px;
}

.metric-card__unit {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-muted);
}

.metric-card__footer {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
}
</style>
