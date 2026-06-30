import { COLLECTION_BY_ENTITY_TYPE, type TripDocument, type TripEntity, type TripEvent } from './trip-types'

export function applyTripEvent(document: TripDocument, event: TripEvent): TripDocument {
  if (event.type === 'entity.create') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: [...collection, event.payload.entity],
    }
  }

  if (event.type === 'entity.update') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: collection.map((entity) =>
        entity.id === event.payload.id ? { ...entity, ...event.payload.patch } : entity,
      ),
    }
  }

  if (event.type === 'entity.delete') {
    const collectionName = COLLECTION_BY_ENTITY_TYPE[event.payload.entityType]
    const collection = document[collectionName] as TripEntity[]
    return {
      ...document,
      [collectionName]: collection.filter((entity) => entity.id !== event.payload.id),
    }
  }

  if (event.type === 'pageNote.update') {
    return {
      ...document,
      pageNotes: {
        ...document.pageNotes,
        [event.payload.pageId]: event.payload.value,
      },
    }
  }

  if (event.type === 'uiState.update') {
    return {
      ...document,
      ui: {
        ...document.ui,
        ...event.payload,
        timeline: { ...document.ui.timeline, ...event.payload.timeline },
        map: { ...document.ui.map, ...event.payload.map },
      },
    }
  }

  return {
    ...document,
    title: event.payload.title ?? document.title,
  }
}

export function replayTripEvents(document: TripDocument, events: readonly TripEvent[]): TripDocument {
  return events.reduce((current, event) => applyTripEvent(current, event), document)
}
