import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { QueueItem } from '../../shared/types'
import { formatTranspose, keyShort } from '../../shared/keys'
import { api } from '../api'
import { usePlayer } from '../stores/player'
import { Cover, formatDuration, formatTime } from './common'
import { IconGrip, IconMinus, IconPlus, IconX } from './icons'
import { newPlaylistFrom, openSongMenu } from './songActions'
import mascotCheer from '../assets/mascot_cheer.webp'

function Item({ item }: { item: QueueItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const setQueue = usePlayer((s) => s.setQueue)
  const playItem = usePlayer((s) => s.playQueueItem)
  const tr = item.transpose ?? item.song.transpose
  const setTr = async (n: number): Promise<void> => setQueue(await api.invoke('queue:setTranspose', item.id, Math.max(-6, Math.min(6, n))))
  return (
    <li
      ref={setNodeRef}
      className={`q-item ${isDragging ? 'dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: item.song.missing ? 0.5 : 1 }}
      onDoubleClick={() => void playItem(item)}
      onContextMenu={(e) =>
        openSongMenu(e, item.song, [
          { label: 'Sing this now', run: () => void playItem(item) },
          { label: 'Remove from queue', run: async () => setQueue(await api.invoke('queue:remove', item.id)), danger: true }
        ])
      }
    >
      <span className="grip" {...attributes} {...listeners} aria-label={`Reorder ${item.song.title}`}>
        <IconGrip />
      </span>
      <Cover song={item.song} />
      <div className="info">
        <span className="t">{item.song.title}</span>
        <span className="a">{item.song.artist}</span>
      </div>
      <span className="tr" title={item.song.key ? `Sung in ${keyShort(item.song.key, tr)}` : 'Key for this turn'}>
        <button aria-label="Lower key for this turn" onClick={() => void setTr(tr - 1)}>
          <IconMinus size={10} />
        </button>
        {tr !== 0 ? <span className="pill mint">{formatTranspose(tr)}</span> : <span className="pill white" style={{ opacity: 0.5 }}>0</span>}
        <button aria-label="Raise key for this turn" onClick={() => void setTr(tr + 1)}>
          <IconPlus size={10} />
        </button>
      </span>
      <span className="num" style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
        {formatTime(item.song.durationMs / 1000)}
      </span>
      <button className="icon-btn xs rm" aria-label={`Remove ${item.song.title} from queue`} onClick={async () => setQueue(await api.invoke('queue:remove', item.id))}>
        <IconX size={11} />
      </button>
    </li>
  )
}

export function QueueCard() {
  const queue = usePlayer((s) => s.queue)
  const setQueue = usePlayer((s) => s.setQueue)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const total = queue.reduce((a, q) => a + q.song.durationMs, 0)

  const onDragEnd = async (e: DragEndEvent): Promise<void> => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = queue.findIndex((q) => q.id === active.id)
    const to = queue.findIndex((q) => q.id === over.id)
    setQueue(arrayMove(queue, from, to))
    setQueue(await api.invoke('queue:move', String(active.id), to))
  }

  return (
    <section className="queue-card" aria-label="Queue">
      <img className="mascot" src={mascotCheer} alt="" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <h2>Up next</h2>
        <span className="sub">{queue.length ? `${queue.length} song${queue.length > 1 ? 's' : ''} · ${formatDuration(total)}` : 'empty'}</span>
      </div>
      {queue.length === 0 ? (
        <div className="queue-empty">
          <span>
            Nothing queued yet.
            <br />
            Hit <b>+</b> on a song to line it up.
          </span>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
          <SortableContext items={queue.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <ol className="queue-list">
              {queue.map((q) => (
                <Item key={q.id} item={q} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div className="queue-foot">
        <button className="btn" style={{ flex: 1 }} disabled={queue.length === 0} onClick={() => newPlaylistFrom(queue.map((q) => q.songId))}>
          Save as playlist
        </button>
        <button className="btn ghost" disabled={queue.length === 0} onClick={async () => setQueue(await api.invoke('queue:clear'))}>
          Clear
        </button>
      </div>
    </section>
  )
}
