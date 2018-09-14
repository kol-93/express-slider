import { EventEmitter } from "events";

type InternalSlidesCallback = (directoryPath: string, cookie: number) => void;

export interface IInternalEmitter extends EventEmitter {
    addListener(event: 'slides', callback: InternalSlidesCallback): this;

    emit(event: 'slides', directoryPath: string, cookie: number): boolean;

    on(event: 'slides', callback: InternalSlidesCallback): this;

    once(event: 'slides', callback: InternalSlidesCallback): this;

    prependListener(event: 'slides', callback: InternalSlidesCallback): this;

    prependOnceListener(event: 'slides', callback: InternalSlidesCallback): this;

    removeListener(event: 'slides', callback: InternalSlidesCallback): this;
}
