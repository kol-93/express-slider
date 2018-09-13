import { EventEmitter } from 'events';

export interface IQueue extends EventEmitter {
    readonly size: number;
    readonly limit: number;
    readonly isReady: boolean;
    readonly threads: number;

    enqueue<ThisType, ResultType, Arg1>(
        this: IQueue,
        method: (this: ThisType) => Promise<ResultType>,
        thisArg: ThisType,
        parameters?: undefined,
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3, Arg4>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3, arg4: Arg4) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3, Arg4],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3, Arg4, Arg5>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3, arg4: Arg4, arg5: Arg5) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3, Arg4, Arg5],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3, arg4: Arg4, arg5: Arg5, arg6: Arg6) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3, Arg4, Arg5, Arg6],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3, arg4: Arg4, arg5: Arg5, arg6: Arg6, arg7: Arg7) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7, Arg8>(
        this: IQueue,
        method: (this: ThisType, arg1: Arg1, arg2: Arg2, arg3: Arg3, arg4: Arg4, arg5: Arg5, arg6: Arg6, arg7: Arg7, arg8: Arg8) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: [Arg1, Arg2, Arg3, Arg4, Arg5, Arg6, Arg7, Arg8],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;
    enqueue<ThisType, ResultType, ArgType>(
        this: IQueue,
        method: (this: ThisType, ...args: ArgType[]) => Promise<ResultType>,
        thisArg: ThisType,
        parameters: ArgType[],
        conditions?: Promise<any>[]
    ): Promise<ResultType>;


    finish(this: IQueue): Promise<void>;

    addListener(event: 'ready', listener: () => void): this;
    on(event: 'ready', listener: () => void): this;
    once(event: 'ready', listener: () => void): this;
    prependListener(event: 'ready', listener: () => void): this;
    prependOnceListener(event: 'ready', listener: () => void): this;
    removeListener(event: 'ready', listener: () => void): this;
    emit(event: 'ready', ): boolean;

    addListener(event: 'busy', listener: () => void): this;
    on(event: 'busy', listener: () => void): this;
    once(event: 'busy', listener: () => void): this;
    prependListener(event: 'busy', listener: () => void): this;
    prependOnceListener(event: 'busy', listener: () => void): this;
    removeListener(event: 'busy', listener: () => void): this;
    emit(event: 'busy', ): boolean;

    addListener(event: 'finish', listener: () => void): this;
    on(event: 'finish', listener: () => void): this;
    once(event: 'finish', listener: () => void): this;
    prependListener(event: 'finish', listener: () => void): this;
    prependOnceListener(event: 'finish', listener: () => void): this;
    removeListener(event: 'finish', listener: () => void): this;
    emit(event: 'finish', ): boolean;


}
