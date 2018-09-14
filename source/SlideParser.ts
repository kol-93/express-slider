import * as gm from "gm";
import * as fs from 'fs';
import * as path from 'path';
import { Deferred } from './Deferred';
import { Dictionary } from "underscore";
import { pad } from "./utilities";
import { promisify } from "util";

interface IFrameGeometry {
    width: number;
    height: number;
    left: number;
    top: number;
}

interface IAnimationInfo {
    Format: string[];
    format: string;
    Geometry: string[];
    size: gm.Dimensions;
    Class: string[];
    Type: string[];
    Depth: string[];
    depth: number;
    'Channel Depths': gm.ChannelInfo<string>;
    'Channel Statistics': gm.ChannelInfo<gm.ColorStatistics>;
    Colors: Dictionary<string>;
    color: number;
    Filesize: string[];
    Interlace: string[];
    Orientation: string;
    'Background Color': string[];
    'Border Color': string[];
    'Matte Color': string[];
    'Page geometry': string[];
    Compose: string[];
    Dispose: string[];
    Delay: string[];
    Scene: string[];
    Compression: string[];
    Signature: string[];
    Tainted: string[];
    'User Time': string[];
    'Elapsed Time': string[];
    'Pixels Per Second': string[];
    path: string;
}


function isAnimationInfo(info: gm.ImageInfo | IAnimationInfo): info is IAnimationInfo {
    return 'Delay' in info;
}

class SlideParser {

    async save(this: SlideParser, sourceFilePath: string, targetDirPath: string): Promise<void> {
        let existsDeferred = new Deferred<NodeJS.ErrnoException, [boolean]>();
        fs.exists(sourceFilePath, existsDeferred.safe);
        let [exists] = await existsDeferred.promise;
        if (!exists) {
            throw new Error(`${JSON.stringify(sourceFilePath)} does not exists`);
        }
        await this._save(sourceFilePath, targetDirPath);
        // SlidesServer._S_emitter.emit('slides', this.target, this.cookie);
    }

    async _save(this: SlideParser, sourceFilePath: string, targetDirPath: string) {
        try {
            let deferred = new Deferred<NodeJS.ErrnoException, [fs.Stats]>();
            fs.stat(targetDirPath, deferred.unsafe);
            let [stat] = await deferred.promise;
            if (!stat.isDirectory()) {
                throw new Error(`${JSON.stringify(targetDirPath)} is not directory`);
            }
        } catch (error) {
            throw new Error(`Invalid target directory. Reason: ${error.message}`);
        }
        let originalFiles: string[] = [];
        try {
            let deferred = new Deferred<NodeJS.ErrnoException, [string[]]>();
            fs.readdir(targetDirPath, deferred.unsafe);
            let [files] = await deferred.promise;
            originalFiles = files.map((file) => path.join(targetDirPath, file));
        } catch (error) {
            console.warn(`SliderApp._save(sourcePath): ${error.stack}`);
        }
        let newFiles: string[] = [];
        let graph = gm(sourceFilePath);
        try {
            let globalIdentifyDeferred = new Deferred<Error, [gm.ImageInfo | IAnimationInfo]>();
            graph.identify(globalIdentifyDeferred.unsafe);
            let [imageFormat] = await globalIdentifyDeferred.promise;
            if (isAnimationInfo(imageFormat)) {
                let {
                    Delay: _delay,
                    size,
                    'Background Color': background,
                    'Border Color': _border,
                    'Page geometry': _geometry,
                    'Compose': compose
                } = imageFormat;
                let delay: number[] = _delay
                    .map((value: any): number => {
                        switch (typeof value) {
                            case 'string':
                                return parseInt(value, 10);
                            case 'number':
                                return value;
                            default:
                                return 0;
                        }
                    })
                    .map((value) => value * 10);
                let geometry: (IFrameGeometry | null)[] = _geometry
                    .map((geometryString): IFrameGeometry | null => {
                        let match = /^(\d+)x(\d+)[+](\d+)[+](\d+)$/.exec(geometryString);
                        if (match instanceof Array) {
                            return {
                                width: parseInt(match[1], 10),
                                height: parseInt(match[2], 10),
                                left: parseInt(match[3], 10),
                                top: parseInt(match[4], 10)
                            };
                        } else {
                            return null;
                        }
                    });
                let tmpSlidePath = path.join(targetDirPath, '_tmp.gif');
                let lastSlidePath = path.join(targetDirPath, '_last.gif');
                for (let slide = 0; slide !== delay.length; ++slide) {
                    let targetDelay = delay[slide].toString(10);
                    let targetIndex = pad(slide, 10, '0', 4);
                    let targetFilePath = path.join(targetDirPath, `slide.${targetIndex}.${targetDelay}.gif`);

                    if (slide === 0) {
                        let writeDeferred = new Deferred<Error, [string, string, string]>();
                        gm(size.width, size.height, background[0])
                            .write(lastSlidePath = targetFilePath, writeDeferred.unsafe);
                        await writeDeferred.promise;
                    }

                    {
                        let tmpDeferred = new Deferred<Error, [string, string, string]>();
                        (graph as any).selectFrame(slide); // @todo State.selectFrame(slide: number)
                        (graph as any).out('+adjoin'); // @todo State.out(option: string)
                        graph.write(tmpSlidePath, tmpDeferred.unsafe);
                        await tmpDeferred.promise;
                    }

                    {
                        let slideGeometry = geometry[slide];
                        if (slideGeometry === null) {
                            slideGeometry = {
                                width: 0,
                                height: 0,
                                left: 0,
                                top: 0
                            };
                        }
                        let writeDeferred = new Deferred<Error, [string, string, string]>();
                        let local_image = gm(lastSlidePath);
                        (local_image as any).composite(tmpSlidePath); // @todo State.composite(imagePath: string)
                        local_image.geometry(`+${slideGeometry.left}+${slideGeometry.top}`);
                        local_image.compose(compose[slide]);
                        local_image.write(lastSlidePath = targetFilePath, writeDeferred.unsafe);
                        await writeDeferred.promise;
                    }

                    try {
                        let unlinkDeferred = new Deferred<NodeJS.ErrnoException, [void]>();
                        fs.unlink(tmpSlidePath, unlinkDeferred.unsafe);
                        await unlinkDeferred.promise;
                    } catch (error) {
                        // ignore
                    }

                    newFiles.push(targetFilePath);
                }
            } else {
                let writeDeferred = new Deferred<Error, [string, string, string]>();
                let targetFilePath = path.join(targetDirPath, `slide.0000.0.jpg`);
                graph.write(targetFilePath, writeDeferred.unsafe);
                await writeDeferred.promise;
                newFiles.push(targetFilePath);
            }
        } catch (error) {
            throw new Error(`Invalid source. Reason: ${error.message}`);
        }
        for (let original of originalFiles) {
            if (newFiles.indexOf(original) < 0) {
                try {
                    let deferred = new Deferred<NodeJS.ErrnoException, [void]>();
                    fs.unlink(original, deferred.unsafe);
                    await deferred.promise;
                } catch (error) {
                    console.warn(`SliderApp._save(sourcePath): ${error.stack}`);
                }
            }
        }
    }


}


const longComputation = () => {
    let sum = 0;
    for (let i = 0; i < 1e10; i++) {
        sum += i;
    };
    return sum;
};

const argv = process.argv.slice(2);
const source = argv[0];
const target = argv[1];

process.on('message', async (msg) => {
    console.log(`[SLIDE-PARSER] Process received message: ${msg}.`);
    // const sum = longComputation();
    console.log(`source`, source, `target`, target);
    const parser = new SlideParser();
    await parser.save(source, target);
    if (process.send) {
        process.send('200');
    } else {
        console.log(`[SLIDE-PARSER] Can't send message about operation complete. process.send is 'undefined'`);
    }
});
