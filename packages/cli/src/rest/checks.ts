import type { AxiosInstance } from 'axios'

export default class Checks {
  api: AxiosInstance
  constructor (api: AxiosInstance) {
    this.api = api
  }

  run (check: any) {
    const type = check.checkType.toLowerCase()
    return this.api.post(`/next/checks/run/${type}`, check)
  }

  runAll (checks: any) {
    const checksPayload = checks.map((check: any) => ({
      type: check.checkType,
      payload: check,
    }))
    return this.api.post('/next/test-sessions/run', { checks: checksPayload })
  }
}
