import * as fs from 'fs';
import * as gifFrames from "gif-frames";
import * as gm from "gm";
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { pad } from "./utilities";
import { IAnimationInfo } from "./interfaces/IAnimationInfo";
import { ISlideParseOptions } from "./interfaces/ISlideParseOptions";

function isAnimationInfo(info: gm.ImageInfo | IAnimationInfo): info is IAnimationInfo {
    return 'Delay' in info;
}

class SlideParser {

    async save(this: SlideParser, options: ISlideParseOptions): Promise<void> {
        const { sourceFilePath, targetDirPath } = options;
        let exists = await promisify(fs.exists)(sourceFilePath);
        if (!exists) {
            throw new Error(`${JSON.stringify(sourceFilePath)} does not exists`);
        }

        //parse this file to separated images and save to tmp directory created before
        await this._save(sourceFilePath, targetDirPath);
    }

    async _save(this: SlideParser, sourceFilePath: string, targetDirPath: string) {
        try {
            let stat = await promisify(fs.stat)(targetDirPath);
            if (!stat.isDirectory()) {
                throw new Error(`${JSON.stringify(targetDirPath)} is not directory`);
            }
        } catch (error) {
            throw new Error(`Invalid target directory. Reason: ${error.message}`);
        }
        let newFiles: string[] = [];
        const graph = gm(sourceFilePath);
        console.time('gm.identify');
        const rawMeta = (await promisify(graph.identify.bind(graph))('%m %T\n') as string);
        console.timeEnd('gm.identify');
        const meta = rawMeta
            .split(os.EOL)
            .map((line) => {
                const match = /^([^\s]+)\s+([0-9]+)$/.exec(line);
                return {
                    format: match![1],
                    time: parseInt(match![2], 10) * 10
                };
            });
        switch (meta.length) {
            case 0:
                throw new Error(`Image invalid`);
            case 1: {
                let targetFilePath = path.join(targetDirPath, `slide.0000.0000.jpg`);
                await promisify(graph.write.bind(graph))(targetFilePath);
                newFiles.push(targetFilePath);
            }
                break;
            default: {
                console.time('gifFrames.read');
                const framesData = await gifFrames({ url: sourceFilePath, outputType: 'jpg', cumulative: true, frames: 'all' });
                console.timeEnd('gifFrames.read');
                console.time('gifFrames.write');
                for (let frame of framesData) {
                    const targetName = path.join(targetDirPath, `slide.${pad(frame.frameIndex, 10, '0', 4)}.${pad(meta[frame.frameIndex].time, 10, '0', 4)}.jpg`);
                    const targetStream = fs.createWriteStream(targetName);
                    try {
                        const sourceStream = frame.getImage();
                        await new Promise((resolve, reject) => {
                            sourceStream.pipe(targetStream);
                            targetStream.once('close', resolve);
                            targetStream.once('error', reject);
                        });
                        if (frame.frameIndex % 20 === 0) {
                            console.log(`[SLIDE-PARSER] Parsed ${frame.frameIndex} of ${framesData.length}`)
                        }
                    } finally {
                        targetStream.removeAllListeners();
                    }
                }
                console.log(`[SLIDE-PARSER] Parsed ${framesData.length} of ${framesData.length}`);
                console.timeEnd('gifFrames.write');
            }
        }
    }
}

const argv = process.argv.slice(2);
const source = argv[0];
const target = argv[1];

process.on('message', async (msg) => {
    console.log(`[SLIDE-PARSER] Receive message: ${msg}`);
    const parser = new SlideParser();
    try {
        console.log(`[SLIDE-PARSER] Parse slides to dir '${target}'....`);
        await parser.save({ sourceFilePath: source, targetDirPath: target });
    } catch (error) {
        console.log(`[SLIDE-PARSER][ERROR]`, error.message);
        if (process.send) {
            process.send(500);
        }
        return;
    }
    if (process.send) {
        //send message to main process that files are already parsed
        process.send(200);
    } else {
        console.log(`[SLIDE-PARSER] Can't send message about operation complete. process.send is 'undefined'`);
    }
});
