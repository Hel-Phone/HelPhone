import { startServer } from './index.js'

if (process.env.NODE_ENV !== 'test') {
  startServer()
}
