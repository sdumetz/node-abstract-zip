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
  extra ?:string;
  flags :number;
}

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

export interface ZipCentralOptions{
  comments?:string;
  //Whether we want to perform additional verifications or not
  strict?:boolean;
}