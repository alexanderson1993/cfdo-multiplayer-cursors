import template from './template.mjs'

export default {
  async fetch(request, env) {
    return handleRequest(request, env)
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
    try {
      switch (url.pathname) {
        case '/':
          return template()
        case '/ws':
          return websocketHandler(request)
        default:
          return new Response('Not found', { status: 404 })
      }
    } catch (err) {
      return new Response(err.toString())
    }
  }

  async websocketHandler(request) {
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 })
    }

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
    for (let ws of this.sessions) {
      ws.websocket.send(JSON.stringify(message))
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
          for (let ws of this.sessions) {
            ws.websocket.send(JSON.stringify(message))
          }
          break
        }
        case 'getState': {
          const message = Object.values(this.sessions).map(({ x, y, id }) => ({
            x,
            y,
            id,
          }))
          websocket.send(JSON.stringify({ type: 'gotState', state: message }))
          break
        }
      }
    })

    websocket.addEventListener('close', async evt => {
      // Handle when a client closes the WebSocket connection
      for (let ws of this.sessions) {
        ws.websocket.send({ type: 'cursorRemoved', id: sessionId })
      }
      console.log(evt)
    })
  }
}

async function handleRequest(request, env) {
  let id = env.router.idFromName('reactpodcast')
  let routerObject = env.router.get(id)

  return routerObject.fetch(request)
}
