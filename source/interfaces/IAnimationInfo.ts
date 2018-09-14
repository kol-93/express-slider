import * as gm from "gm";
import { Dictionary } from "underscore";

export interface IAnimationInfo {
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
