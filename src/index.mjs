import template from './template.mjs'

export default {
  async fetch(request, env) {
    return await handleRequest(request, env)
  },
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export class Router {
  constructor(controller, env) {
    this.storage = controller.storage
    this.env = env
    this.sessions = {}
  }

  async fetch(request) {
    let url = new URL(request.url)
    console.log({ url })

    try {
      switch (url.pathname) {
        case '/':
          return template()
        case '/ws': {
          return await this.websocketHandler(request)
        }
        default:
          return new Response('Not found', { status: 404 })
      }
    } catch (err) {
      throw new Error(err)
      return new Response(err.toString(), { status: 500 })
    }
  }

  async websocketHandler(request) {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 })
    }

    // console.log({ request })

    const [client, server] = Object.values(new WebSocketPair())
    await this.handleSession(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async handleSession(websocket) {
    websocket.accept()
    const sessionId = generateUUID()
    this.sessions[sessionId] = { id: sessionId, websocket, x: 0, y: 0 }

    const message = {
      type: 'cursorAdded',
      cursor: { id: sessionId, x: 0, y: 0 },
    }

    for (let sessionIdIterator in this.sessions) {
      if (sessionIdIterator === sessionId) continue
      const session = this.sessions[sessionIdIterator]
      try {
        session.websocket.send(JSON.stringify(message))
      } catch (error) {
        delete this.sessions[session.id]
      }
    }

    websocket.addEventListener('message', async ({ data }) => {
      const parsed = JSON.parse(data)
      switch (parsed.type) {
        case 'cursorMoved': {
          const message = {
            type: 'cursorsMoved',
            movedCursors: [{ id: sessionId, x: parsed.x, y: parsed.y }],
          }
          this.sessions[sessionId].x = parsed.x
          this.sessions[sessionId].y = parsed.y

          for (let sessionIdIterator in this.sessions) {
            if (sessionIdIterator === sessionId) continue
            const session = this.sessions[sessionIdIterator]
            try {
              session.websocket.send(JSON.stringify(message))
            } catch (error) {
              websocket.send(
                JSON.stringify({ type: 'gotError', err: error, session }),
              )
              delete this.sessions[session.id]
            }
          }
          break
        }
        case 'getState': {
          const otherCursors = Object.values(this.sessions).filter(
            ({ id }) => id !== sessionId,
          )
          const message = otherCursors.map(({ x, y, id }) => ({
            x,
            y,
            id,
          }))
          this.sessions[sessionId].websocket.send(
            JSON.stringify({ type: 'gotState', state: message }),
          )
          break
        }
      }
    })

    websocket.addEventListener('close', async evt => {
      // Handle when a client closes the WebSocket connection

      const message = { type: 'cursorRemoved', id: sessionId }
      for (let sessionIdIterator in this.sessions) {
        const session = this.sessions[sessionIdIterator]
        try {
          session.websocket.send(JSON.stringify(message))
        } catch (error) {
          delete this.sessions[session.id]
        }
      }
      delete this.sessions[sessionId]
      console.log(evt)
    })
  }
}

async function handleRequest(request, env) {
  let id = env.router.idFromName('reactpodcast')
  let routerObject = env.router.get(id)

  return routerObject.fetch(request)
}
