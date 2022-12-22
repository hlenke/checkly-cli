import { Command } from '@oclif/core'
import config from '../services/config'
import * as api from '../rest/api'

export default class Whoami extends Command {
  static description = 'See your logged account and user'
  async run (): Promise<void> {
    const accountId = config.getAccountId()

    if (!accountId) {
      console.info('You first need to login to use this command')
      process.exit(0)
    }
    try {
      const { data: account } = await api.accounts.get(accountId)
      console.info(`You are currently on "${account.name}" with id ${account.id}`)
    } catch (e) {
      console.error('Failed to find an account corresponding to the account id')
    }
  }
}