import { handler } from './index'
import { callbackMock, contextMock, eventMock } from '../common/handler_arg_mock'

(handler)(eventMock, contextMock, callbackMock)
