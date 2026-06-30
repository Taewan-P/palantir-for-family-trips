import { Plus, Trash2 } from 'lucide-react'

import { COLLECTION_BY_ENTITY_TYPE } from '../shared/trip-types'
import type { TripDocument, TripEntityType } from '../shared/trip-types'

type EntityCrudPanelProps = {
  document: TripDocument
  entityType: TripEntityType
  readOnly: boolean
  canDelete: (entityType: TripEntityType, id: string) => boolean
  onCreate: (entityType: TripEntityType) => void
  onDelete: (entityType: TripEntityType, id: string) => void
}

export function EntityCrudPanel({ document, entityType, readOnly, canDelete, onCreate, onDelete }: EntityCrudPanelProps) {
  const collectionName = COLLECTION_BY_ENTITY_TYPE[entityType]
  const entities = document[collectionName]

  return (
    <section className="border border-[#30363D] bg-[#161B22] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#8B949E]">
          {entityType} records
        </div>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onCreate(entityType)}
          title={`Add ${entityType}`}
          className="inline-flex h-7 items-center gap-1 border border-[#30363D] px-2 text-[9px] font-black uppercase tracking-wider text-[#58A6FF] transition-colors hover:border-[#58A6FF]/50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
      <div className="grid max-h-64 gap-1 overflow-auto">
        {entities.map((entity) => {
          const deleteDisabled = readOnly || !canDelete(entityType, entity.id)

          return (
            <div
              key={entity.id}
              className="flex items-center justify-between gap-2 border border-[#30363D]/60 bg-[#0d1117] px-2 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-[11px] font-bold text-[#C9D1D9]">
                  {entity.title || entity.name || entity.id}
                </div>
                <div className="truncate font-mono text-[9px] text-[#8B949E]">{entity.id}</div>
              </div>
              <button
                type="button"
                disabled={deleteDisabled}
                onClick={() => onDelete(entityType, entity.id)}
                title={deleteDisabled ? 'Referenced records cannot be deleted here' : `Delete ${entity.title || entity.name || entity.id}`}
                className="inline-flex h-7 shrink-0 items-center gap-1 px-2 text-[9px] font-black uppercase tracking-wider text-[#F85149] transition-colors hover:bg-[#F85149]/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
