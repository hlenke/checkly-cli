import type { AxiosInstance } from 'axios'

type TriggerTestSessionRequest = {
  runLocation: string|{ type: 'PUBLIC', region: string }|{ type: 'PRIVATE', slugName: string, id: string },
  shouldRecord: boolean,
  targetTags: string[],
  checkRunSuiteId: string,
}

class TestSessions {
  api: AxiosInstance
  constructor (api: AxiosInstance) {
    this.api = api
  }

  trigger (payload: TriggerTestSessionRequest) {
    return this.api.post('/next/test-sessions/trigger', payload)
  }
}

export default TestSessions
