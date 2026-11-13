/// <reference lib="webworker" />
import { createFlowEngine } from './engine.js';

const engine = createFlowEngine((msg, transfer) => self.postMessage(msg, transfer));
self.onmessage = (e) => engine(e.data);
