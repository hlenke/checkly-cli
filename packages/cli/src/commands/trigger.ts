import { Flags } from '@oclif/core'

import * as api from '../rest/api'
import { AuthCommand } from './authCommand'
import { loadChecklyConfig } from '../services/checkly-config-loader'
import { splitConfigFilePath } from '../services/util'
import type { Region } from '..'
import CheckRunner, { RunLocation, Events, PrivateRunLocation } from '../services/check-trigger-runner'
import config from '../services/config'

const DEFAULT_REGION = 'eu-central-1'

export default class Trigger extends AuthCommand {
  static hidden = false
  static description = 'Trigger checks on Checkly'
  static flags = {
    location: Flags.string({
      char: 'l',
      description: 'The location to run the checks at.',
    }),
    'private-location': Flags.string({
      description: 'The private location to run checks at.',
      exclusive: ['location'],
    }),
    tag: Flags.string({
      char: 't',
      description: 'Run checks matching the specified tag.',
      multiple: true,
      required: true,
    }),
    config: Flags.string({
      char: 'c',
      description: 'The Checkly CLI config filename.',
    }),
  }

  async run (): Promise<void> {
    const { flags } = await this.parse(Trigger)
    const {
      location: runLocation,
      'private-location': privateRunLocation,
      config: configFilename,
      tag: targetTags,
    } = flags
    const { configDirectory, configFilenames } = splitConfigFilePath(configFilename)
    
    // TODO: We don't _realy_ need the checkly config file. We should handle it missing gracefully.
    const { config: checklyConfig } = await loadChecklyConfig(configDirectory, configFilenames)
    const location = await this.prepareRunLocation(checklyConfig.cli, {
      runLocation: runLocation as keyof Region,
      privateRunLocation,
    })
    
    const runner = new CheckRunner(
      config.getAccountId(),
      config.getApiKey(),
      targetTags,
      location,
      240,
      false,
    )
    // TODO: the reporter is quite coupled to having logical Ids. Need to work on that.
    // let reporter
    runner.on(Events.RUN_STARTED, (checks) => {
      // TODO: Add support for the --reporter flag
      // Unlike in the `checkly test` command, we don't know up-front which checks will be run.
      // To support this, we need to wait for the response from POST /test-sessions/trigger
      // Then we'll be able to initialize the reporter
      
      // reporter = new ListReporter(location, checks, false)
    })
    runner.on(Events.CHECK_SUCCESSFUL, (check, result) => {
      if (result.hasFailures) {
        process.exitCode = 1
      }
      console.log('CHECK_SUCCESSFUL', check, result)
    })
    runner.on(Events.CHECK_FAILED, (check, message) => {
      console.log('CHECK_FAILED', check, message)
      process.exitCode = 1
    })
    runner.on(Events.RUN_FINISHED, () => console.log('RUN_FINISHED'))
    runner.on(Events.ERROR, () => console.log('ERROR'))
    await runner.run()
  }
    
  
  // TODO: Reuse Test.prepareRunLocation and Test.preparePrivateRunLocation.
  async prepareRunLocation (
    configOptions: { runLocation?: keyof Region, privateRunLocation?: string } = {},
    cliFlags: { runLocation?: keyof Region, privateRunLocation?: string } = {},
  ): Promise<RunLocation> {
    // Command line options take precedence
    if (cliFlags.runLocation) {
      const { data: availableLocations } = await api.locations.getAll()
      if (availableLocations.some(l => l.region === cliFlags.runLocation)) {
        return { type: 'PUBLIC', region: cliFlags.runLocation }
      }
      throw new Error(`Unable to run checks on unsupported location "${cliFlags.runLocation}". ` +
        `Supported locations are:\n${availableLocations.map(l => `${l.region}`).join('\n')}`)
    } else if (cliFlags.privateRunLocation) {
      return this.preparePrivateRunLocation(cliFlags.privateRunLocation)
    } else if (configOptions.runLocation && configOptions.privateRunLocation) {
      throw new Error('Both runLocation and privateRunLocation fields were set in the Checkly config file.' +
        ` Please only specify one run location. The configured locations were' + 
        ' "${configOptions.runLocation}" and "${configOptions.privateRunLocation}"`)
    } else if (configOptions.runLocation) {
      return { type: 'PUBLIC', region: configOptions.runLocation }
    } else if (configOptions.privateRunLocation) {
      return this.preparePrivateRunLocation(configOptions.privateRunLocation)
    } else {
      return { type: 'PUBLIC', region: DEFAULT_REGION }
    }
  }

  async preparePrivateRunLocation (privateLocationSlugName: string): Promise<PrivateRunLocation> {
    try {
      const { data: privateLocations } = await api.privateLocations.getAll()
      const privateLocation = privateLocations.find(({ slugName }) => slugName === privateLocationSlugName)
      if (privateLocation) {
        return { type: 'PRIVATE', id: privateLocation.id, slugName: privateLocationSlugName }
      }
      const { data: account } = await api.accounts.get(config.getAccountId())
      throw new Error(`The specified private location "${privateLocationSlugName}" was not found on account "${account.name}".`)
    } catch (err: any) {
      throw new Error(`Failed to get private locations. ${err.message}.`)
    }
  }
}
