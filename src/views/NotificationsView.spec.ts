import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import NotificationsView from './NotificationsView.vue'

describe('NotificationsView', () => {
  it('shows the notification history empty state when no records are available', () => {
    const wrapper = mount(NotificationsView)

    expect(wrapper.get('[data-test="notifications-empty"]').text()).toBe('尚無通知紀錄')
  })
})
