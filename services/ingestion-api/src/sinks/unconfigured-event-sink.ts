import { SinkUnavailableError, type EventSink } from './event-sink.js';
export const unconfiguredEventSink: EventSink = { async accept() { throw new SinkUnavailableError(); } };
