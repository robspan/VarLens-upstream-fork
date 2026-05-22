import type { FastifyInstance } from 'fastify'

export interface WebEvent {
  type: string
  payload: unknown
}

type WebEventListener = (event: WebEvent) => void

export class WebEventHub {
  private readonly listenersByUser = new Map<number, Set<WebEventListener>>()

  subscribe(userId: number, listener: WebEventListener): () => void {
    let listeners = this.listenersByUser.get(userId)
    if (listeners === undefined) {
      listeners = new Set()
      this.listenersByUser.set(userId, listeners)
    }
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listenersByUser.delete(userId)
      }
    }
  }

  publish(userId: number, type: string, payload: unknown): void {
    const listeners = this.listenersByUser.get(userId)
    if (listeners === undefined) return

    for (const listener of listeners) {
      listener({ type, payload })
    }
  }
}

export function registerEventStream(app: FastifyInstance, events: WebEventHub): void {
  app.get('/api/events', async (request, reply) => {
    const user = request.session.user
    if (user === undefined) {
      reply.code(401)
      return { code: 'UNAUTHENTICATED', message: 'authentication required' }
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    reply.raw.write(': connected\n\n')

    const unsubscribe = events.subscribe(user.id, (event) => {
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event.payload)}\n\n`)
    })

    request.raw.on('close', unsubscribe)
  })
}
