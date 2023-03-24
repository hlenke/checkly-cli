/**
* This is _almost_ the same as check-runner.
* The key difference is that we don't know up-front which checks are going to run, or what the corresponding checkRunIds are.
* We need to actually wait for the response of `POST /test-sessions/triggered` to get the checks and checkRunIds.
* This data is then needed to configure the reporter and is propagated in the RUN_STARTED event.
* When receiving a WebSocket event, we also await that the checkRunIds map is configured, to avoid a race condition.
*/


import { testSessions, assets } from '../rest/api'
import { SocketClient } from './socket-client'
import * as uuid from 'uuid'
import { EventEmitter } from 'node:events'
import type { AsyncMqttClient } from 'async-mqtt'
import type { Region } from '..'

// eslint-disable-next-line no-restricted-syntax
export enum Events {
  CHECK_REGISTERED = 'CHECK_REGISTERED',
  CHECK_INPROGRESS = 'CHECK_INPROGRESS',
  CHECK_FAILED = 'CHECK_FAILED',
  CHECK_SUCCESSFUL = 'CHECK_SUCCESSFUL',
  CHECK_FINISHED = 'CHECK_FINISHED',
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  ERROR = 'ERROR',
}

export type PrivateRunLocation = {
  type: 'PRIVATE',
  id: string,
  slugName: string,
}
export type PublicRunLocation = {
  type: 'PUBLIC',
  region: keyof Region,
}
export type RunLocation = PublicRunLocation | PrivateRunLocation

type CheckRunId = string

export default class CheckRunner extends EventEmitter {
  // If there's an error in the backend and no check result is sent, the check run could block indefinitely.
  // To avoid this case, we set a per-check timeout.
  timeouts: Map<CheckRunId, NodeJS.Timeout>
  location: RunLocation
  accountId: string
  apiKey: string
  timeout: number
  verbose: boolean
  targetTags: string[]
  // This will keep track of the checks that are running.
  // checkRunIds is a map from checkRunId to check id
  // It's a promise since we don't have this info until after the `POST /test-sessions/trigger` call.
  checks?: Promise<{ checks: any[], checkRunIds: Record<string, string> }>
  allChecksFinishedPromise?: Promise<void>

  constructor (
    accountId: string,
    apiKey: string,
    targetTags: string[],
    location: RunLocation,
    timeout: number,
    verbose: boolean,
  ) {
    super()
    this.targetTags = targetTags
    this.timeouts = new Map()
    this.location = location
    this.accountId = accountId
    this.apiKey = apiKey
    this.timeout = timeout
    this.verbose = verbose
  }

  async run () {
    const socketClient = await SocketClient.connect()
    const checkRunSuiteId = uuid.v4()
    // Configure the socket listener and allChecksFinished listener before starting checks to avoid race conditions
    await this.configureResultListener(checkRunSuiteId, socketClient)
    try {
      this.checks = this.scheduleAllChecks(checkRunSuiteId)
      await this.checks
      await this.allChecksFinishedPromise
      this.emit(Events.RUN_FINISHED)
    } catch (err) {
      this.emit(Events.ERROR, err)
    } finally {
      await socketClient.end()
    }
  }

  private async scheduleAllChecks (checkRunSuiteId: string): Promise<{ checks: any[], checkRunIds: Record<string, string> }> {
    const response = await testSessions.trigger({
      shouldRecord: true, // TODO: Make configurable
      runLocation: this.location,
      checkRunSuiteId,
      targetTags: this.targetTags,
    })
    const { checks, checkRunIds } = response.data
    this.allChecksFinishedPromise = this.allChecksFinished(checks.length)
    for (const check of checks) {
      const checkRunId = checkRunIds[check.id]
      this.timeouts.set(checkRunId, setTimeout(() => {
        this.timeouts.delete(checkRunId)
        this.emit(Events.CHECK_FAILED, check, `Reached timeout`)
        this.emit(Events.CHECK_FINISHED, check)
      }, this.timeout * 1000))
    }
    this.emit(Events.RUN_STARTED, checks)
    return { 
      checks, 
      // checkRunIds is a map from check id to checkRunId.
      // It would actually be more useful to have a map from checkRunId to checkId!
      // TODO: We should change this in the endpoint.
      checkRunIds: this.objectFlip(checkRunIds),
    }
  }

  private async configureResultListener (checkRunSuiteId: string, socketClient: AsyncMqttClient): Promise<void> {
    socketClient.on('message', async (topic: string, rawMessage: string|Buffer) => {
      const message = JSON.parse(rawMessage.toString('utf8'))
      const topicComponents = topic.split('/')
      const checkRunId = topicComponents[4]
      const subtopic = topicComponents[5]
      // Need to await `this.checks`.
      // It's always defined at this point, so the ! operator is safe.
      const { checks, checkRunIds } = await this.checks!
      const checkId = checkRunIds[checkRunId]
      // TODO: It would probably be better to have a map, checkId->check, rather than needing to call `find`
      const check = checks.find(check => check.id === checkId)
      if (!this.timeouts.has(checkRunId)) {
        // The check has already timed out. We return early to avoid reporting a duplicate result.
        return
      }
      if (subtopic === 'run-start') {
        this.emit(Events.CHECK_INPROGRESS, check)
      } else if (subtopic === 'run-end') {
        this.disableTimeout(checkRunId)
        const { result } = message
        const { region, logPath, checkRunDataPath } = result.assets
        if (logPath && (this.verbose || result.hasFailures)) {
          result.logs = await assets.getLogs(region, logPath)
        }
        if (checkRunDataPath && (this.verbose || result.hasFailures)) {
          result.checkRunData = await assets.getCheckRunData(region, checkRunDataPath)
        }
        this.emit(Events.CHECK_SUCCESSFUL, check, result)
        this.emit(Events.CHECK_FINISHED, check)
      } else if (subtopic === 'error') {
        this.disableTimeout(checkRunId)
        this.emit(Events.CHECK_FAILED, check, message)
        this.emit(Events.CHECK_FINISHED, check)
      }
    })
    await socketClient.subscribe(`account/${this.accountId}/ad-hoc-check-results/${checkRunSuiteId}/+/+`)
  }

  private async allChecksFinished (numChecks: number): Promise<void> {
    let finishedCheckCount = 0
    if (numChecks === 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.on(Events.CHECK_FINISHED, () => {
        finishedCheckCount++
        if (finishedCheckCount === numChecks) resolve()
      })
    })
  }

  private disableTimeout (checkRunId: string) {
    const timeout = this.timeouts.get(checkRunId)
    clearTimeout(timeout)
    this.timeouts.delete(checkRunId)
  }

  private objectFlip (obj: any) {
    const ret: any = {}
    Object.keys(obj).forEach(key => {
      ret[obj[key]] = key
    })
    return ret
  }
}
