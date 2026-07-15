import { createUuid } from './uuid'

export class RecommendationSession {
  private feedSessionId = createUuid()
  private ownerUserId: string | undefined

  constructor(ownerUserId?: string) {
    this.ownerUserId = ownerUserId
  }

  getFeedSessionId(ownerUserId?: string) {
    if (this.ownerUserId !== ownerUserId) {
      this.ownerUserId = ownerUserId
      this.feedSessionId = createUuid()
    }

    return this.feedSessionId
  }

  refresh(ownerUserId?: string) {
    this.ownerUserId = ownerUserId
    this.feedSessionId = createUuid()

    return this.feedSessionId
  }
}
