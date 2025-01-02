import type { Readable } from "node:stream";

export interface Entry{
  filename :string;
  compression:number;
  mtime :Date;
}

export interface ZipEntry<T extends Readable = Readable> extends Entry{
  isDirectory ?:boolean;
  compression?:number;
  stream ?:T;
}

export interface FileHeader extends Entry{
  /** Uncompressed size of the file. 
   * If known it is useful to be able to predict if a Zip64 header is needed.
   * When not provided a Zip64 extra field will always be added
   * */
  size ?:number;
  compressedSize ?:number;
  crc ?:number;
  extra ?:ExtraData;
  flags :number;
}


export type ExtraData = Map<number, Buffer>;

export interface CDHeader extends FileHeader{
  dosMode :number;
  unixMode :number;
  size :number;
  compressedSize :number;
  crc :number;
  offset :number;
}

export interface ZipExtractEntry extends Entry{
  /**start offset from start of file, inclusive */
  start: number;
  /**end offset from start of file, inclusive */
  end :number;
  isDirectory: boolean;
}


export interface DataDescriptor {
  size: number;
  compressedSize?: number;
  crc: number;
}