import fs, {FileHandle} from "node:fs/promises";
import zlib from "node:zlib";
import assert from "node:assert/strict";
import { Readable, Transform } from "node:stream";
import { createReadStream } from "node:fs";

import { crc32 } from "./utils/crc32.js";

import {file_header_length, eocd_length, flags, ECompression} from "./constants.js";
import {CDHeader, ZipEntry, ZipExtractEntry} from "./types.js";

import {create_cd_header, parse_cd } from "./records/cd.js";
import {create_file_header} from "./records/file.js";
import {create_data_descriptor} from "./records/dd.js";
import {create_eocd_record, find_eocd_index, parse_eocd_record} from "./records/eocd.js";
import {create_zip64_eocd_record} from "./records/zip64.js";




export function isDirectory(h:CDHeader):boolean{
  return (h.dosMode & 0x10)?true:false;
}

/**
 * simple implementation of Zip to allow export
 * Should be compatible with standard implementations
 * @see https://pkware.cachefly.net/webdocs/APPNOTE/APPNOTE-6.3.0.TXT
 */
export async function *zip(files :AsyncIterable<ZipEntry>|Iterable<ZipEntry>, {comments = ""}={}) :AsyncGenerator<Buffer,void,unknown>{

  let cd = Buffer.allocUnsafe(0);
  let files_count = 0, archive_size = 0;

  let flag_bits = flags.USE_DATA_DESCRIPTOR | flags.UTF_FILENAME;
  for await (let {filename, mtime, stream, isDirectory, compression} of files){
    if(!stream && !isDirectory){
      throw new Error("Files require a Readable stream");
    }
    if(isDirectory){
      filename += (filename.endsWith("/")?"":"/");
    }
    if(typeof compression === "undefined"){
      compression = ECompression.NO_COMPRESSION;
    }

    files_count++;
    if(Number.isNaN(mtime?.valueOf())){
      mtime = new Date(); //Defaults to "now", which is debatable, but we shouldn't have to.
    }else if(mtime.getUTCFullYear() < 1980){
      mtime = new Date("1980-01-01T00:00:00Z");
    }

    const local_header_offset = archive_size;

    //File header
    let header = create_file_header({filename, mtime, flags: flag_bits, compression});
    yield header; 
    archive_size += header.length;
    //End of file header

    let size = 0, compressedSize = 0;
    let sum = crc32();
    if(stream){
      let dataStream = stream.pipe(new Transform({
        transform(chunk, encoding, callback){
          sum.next(chunk);
          size += chunk.length;
          callback(null, chunk);
        }
      }))

      if(compression === ECompression.DEFLATE){
        dataStream = dataStream.pipe(zlib.createDeflateRaw());
      }else if(compression !== ECompression.NO_COMPRESSION){
        stream.destroy();
        throw new Error(`Unsupported compression method : ${ECompression[compression] ?? compression}`)
      }

      dataStream = dataStream.pipe(new Transform({
        transform(chunk, encoding, callback){
          compressedSize += chunk.length;
          callback(null, chunk);
        }
      }));

      yield * dataStream;
      archive_size += compressedSize;
    }

    let crc = sum.next().value;
    //Data descriptor
    let dd = create_data_descriptor({size, crc});
    yield dd;
    archive_size += dd.length;
    
    //Construct central directory record for later use
    let cdr = create_cd_header({
      filename,
      compression,
      compressedSize,
      size,
      crc,
      flags: flag_bits,
      mtime,
      dosMode: (isDirectory? 0x10: 0),
      unixMode: parseInt((isDirectory? "040755":"100644"), 8),
      offset: local_header_offset,
    });

    //Append to central directory buffer
    cd = Buffer.concat([cd, cdr]);
  }

  // Digital signature is omitted until we support encryption
  // It would be appended to `cd`
  yield cd;

  const eocd_record = {
    files_count,
    cd_length: Math.min(cd.length, 0xffffffff),
    data_length: Math.min(archive_size, 0xffffffff),
    comments,
  }

  const is_zip64 =  0xffffffff <= cd.length || 0xffffffff < archive_size;
  if(is_zip64){
    yield create_zip64_eocd_record(eocd_record);
  }

  //End of central directory
  yield create_eocd_record(eocd_record);
}


/**
 * search for an "end of central directory record" at the end of the file.
 * That is, something with 0x06054b50. Then check for false positives by verifying if comment length matches.
 */
async function find_eocd_buffer(handle :FileHandle) :Promise<Buffer>{
  let stats = await handle.stat();
  //We expect comments to be below 65kb.
  let b = Buffer.alloc(65535);
  let {bytesRead} = await handle.read({buffer: b, position: Math.max(stats.size - 65535, 0)});
  let offset = find_eocd_index(b, bytesRead);
  if(offset < 0){
    throw new Error("Could not find end of central directory record");
  }
  return b.subarray(offset);
}

/**
 * Scan a file from the end to find the location of the "End of Central Directory" record
 */
export async function find_eocd_record(handle :FileHandle){
  let slice = await find_eocd_buffer(handle);
  return parse_eocd_record(slice);
}


/**
 * 
 * Iterate over a file's central directory headers
 * It only read the file once before the first loop so it's safe to just unwrap the iterator
 * the entry's offset and size includes the file header.
 */
export async function *read_cdh(handle : FileHandle) :AsyncGenerator<CDHeader, void, void >{
  let eocd = await find_eocd_record(handle);
  let cd = Buffer.allocUnsafe(eocd.cd_length);
  let bytes = (await handle.read({buffer:cd, position: eocd.data_length})).bytesRead;
  assert( bytes == cd.length, `Can't read Zip Central Directory Records (missing ${cd.length - bytes} of ${cd.length} bytes)`);
  yield* parse_cd(cd.subarray(0, eocd.cd_length));
}




/**
 * Unpacks a zip file to an iterator of ZipEntry
 * Can't work from a stream beacause it must read the end of the file (Central Directory) first.
 * It modifies the entry returned from parse_cd_header to exclude the file header and data descriptor
 */
export async function listEntries(filepath :string) :Promise<ZipExtractEntry[]>
  export async function listEntries(fd :FileHandle) :Promise<ZipExtractEntry[]>
export async function listEntries(file :string|FileHandle) :Promise<ZipExtractEntry[]>{
  let handle = typeof file ==="string"? await fs.open(file, "r"):file;
  let entries = [];

  try{
    for await (let entry of read_cdh(handle)){
      //We don't parse the file's header because there is nothing we don't already know there. We only need the size
      let header = Buffer.alloc(file_header_length);
      await handle.read({buffer:header, position: entry.offset });
      assert.equal(header.readUInt32LE(0), 0x04034b50, `can't find magic byte at file header start`);
      //assert.equal(header.readUInt16LE(8), 0, `Only uncompressed data is supported at the moment`);
      let header_length = file_header_length + header.readUInt16LE(26 /*name length*/) + header.readUInt16LE(28 /*extra length*/);
      entries.push({
        filename: entry.filename,
        mtime: entry.mtime,
        compression: entry.compression,
        start:( entry.compressedSize? entry.offset+header_length : 0),
        end: (entry.compressedSize?  entry.offset+header_length + entry.compressedSize -1 :0), //Make it inclusive
        isDirectory: isDirectory(entry),
      });
    }
  }finally{
    if(typeof file ==="string") await handle.close();
  }
  return entries;
}


export function openEntry(filepath: string, entry :ZipExtractEntry) :Readable
export function openEntry(fd: number, entry :ZipExtractEntry) :Readable
export function openEntry(filepath: string|number, entry :ZipExtractEntry) :Readable{
  let fd = (typeof filepath === "number")? filepath:undefined
  if(entry.isDirectory) throw new Error(`Entry is a directory`);
  let rs:Readable = createReadStream(filepath as string, {
    fd,
    autoClose: (fd?false: true),
    start: entry.start,
    end: entry.end,
  });
  if(entry.compression == ECompression.NO_COMPRESSION){
    return rs;
  } else if(entry.compression == ECompression.DEFLATE){
    return rs.pipe(zlib.createInflateRaw());
  }else{
    rs.destroy();
    /* c8 ignore next */
    throw new Error(`Unsupported compression method : ${ECompression[entry.compression]?? entry.compression}`);
  }
}
