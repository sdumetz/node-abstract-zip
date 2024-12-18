import type { Readable } from "node:stream";

type StreamTypes = Readable|AsyncIterableIterator<Buffer>|IterableIterator<Buffer>|Buffer[];

export interface Entry{
  filename :string;
  mtime :Date;

}

export interface ZipEntry<T extends StreamTypes = StreamTypes> extends Entry{
  isDirectory ?:boolean;
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
