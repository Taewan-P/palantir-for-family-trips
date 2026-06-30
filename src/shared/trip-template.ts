import { createInitialTripDocument } from '../tripModel'
import type { TripDocument } from './trip-types'

export type CreateTripFromTemplateInput = {
  id: string
  title: string
}

export function createTripFromTemplate(input: CreateTripFromTemplateInput): TripDocument {
  const document = createInitialTripDocument()
  return {
    ...document,
    id: input.id,
    title: input.title,
    ui: {
      ...document.ui,
      searchQuery: '',
    },
  }
}
