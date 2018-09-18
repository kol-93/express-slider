
declare module "gif-frames" {
    function gifFrames(options: gifFrames.IExtractOptions, callback?: (error?: Error, framesData?: gifFrames.IFrameData[]) => any): Promise<gifFrames.IFrameData[]>;
    namespace gifFrames {
        export interface IExtractOptions {
            url: string;
            frames: string;
            outputType?: 'jpg' | 'png' | 'gif';
            quality?: number;
            cumulative?: boolean;
        }

        export interface IFrameData {
            getImage(): NodeJS.WriteStream;
            frameIndex: number;
        }
    }

    export = gifFrames;
}
