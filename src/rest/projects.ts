import type { AxiosInstance } from 'axios'

const PATH = 'projects'

export interface Project {
  name: string
  logicalId: string
  repoUrl?: string
}

export interface ProjectSync {
  project: Project,
  checks: Record<string, any>
  groups: Record<string, any>
  alertChannels: Record<string, any>
  alertChannelSubscriptions: Record<string, any>
}

class Projects {
  api: AxiosInstance
  constructor (api: AxiosInstance) {
    this.api = api
  }

  getAll () {
    return this.api.get<Array<Project>>(`/next/${PATH}`)
  }

  get (accountId: string) {
    return this.api.get<Project>(`/next/${PATH}/${accountId}`)
  }

  create (project: Project) {
    return this.api.post(`/next/${PATH}`, project)
  }

  deleteProject (id: string) {
    return this.api.delete(`/next/${PATH}/${id}`)
  }

  deploy (resources: ProjectSync, { dryRun = false } = {}) {
    return this.api.post(
      `/next/${PATH}/deploy?dryRun=${dryRun}`,
      resources,
    )
  }
}

export default Projects
