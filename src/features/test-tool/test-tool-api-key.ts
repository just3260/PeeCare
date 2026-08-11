import type { InjectionKey } from 'vue'

import type { TestToolApi } from './test-tool-api'

/** The development route consumes the single adapter created by the app composition root. */
export const TEST_TOOL_API_KEY: InjectionKey<TestToolApi> = Symbol('test-tool-api')
