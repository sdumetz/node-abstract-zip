import type { Readable } from "node:stream";

export interface Entry{
  filename :string;
  compression:number;
  mtime :Date;
}

export interface ZipEntry<T extends Readable = Readable> extends Entry{
  isDirectory ?:boolean;
  compression?:number;
  /** Uncompressed size of the file. 
   * If known it is useful to be able to predict if a Zip64 header is needed.
   * When not provided a Zip64 extra field will always be added
   * */
  size ?:number;
  stream ?:T;
}

export interface FileHeader extends Entry{
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


export interface EOCDRecordParams{
  /**Total number of files in this archive */
  files_count:number;
  /**Byte length of the central directory headers */
  cd_length: number;
  /**Byte length of the archive's data */
  data_length: number;
  comments?:string|Buffer;
}

export interface EOCDRecord extends EOCDRecordParams{
  comments :string;
}

/**
 * 
 * @note Zip64's max size should be 2^64-1
 * But because we use js's native numbers we are limited to MAX_SAFE_INTEGER,
 * That is 2^53 -1 or 9PB of data. Hopefully nobody will notice.
 * If you do notice, please submit a feature request for BigInt support.
 */
export interface Zip64EOCDRecord extends Omit<EOCDRecord, "comments">{
  ext: ExtraData;
  made_by :number;
  version :number;
  version_needed :number;
}

export interface Zip64EOCDRecordParams extends Omit<EOCDRecordParams, "comments">{
  ext?: ExtraData;
}

export type Zip64ExtraField = Pick<CDHeader, "size"|"compressedSize"|"offset">;