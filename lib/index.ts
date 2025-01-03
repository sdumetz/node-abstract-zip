import fs, {FileHandle} from "node:fs/promises";
import zlib from "node:zlib";
import assert from "node:assert/strict";
import { Readable, Transform } from "node:stream";
import { createReadStream } from "node:fs";
import { debuglog } from "node:util";

import { crc32 } from "./utils/crc32.js";

import {file_header_length, eocd_length, flags, ECompression, zip64_locator_length} from "./constants.js";
import {CDHeader, ExtraData, ZipEntry, ZipExtractEntry} from "./types.js";

import {create_cd_header, parse_cd } from "./records/cd.js";
import {create_file_header} from "./records/file.js";
import {create_data_descriptor} from "./records/dd.js";
import {create_eocd_record, EOCDRecord, find_eocd_index, parse_eocd_record} from "./records/eocd.js";
import {create_zip64_data_descriptor, create_zip64_eocd_record, create_zip64_extra_field, parse_zip64_eocd_locator, parse_zip64_eocd_record} from "./records/zip64.js";

import * as log from "./utils/debug.js";


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

  for await (let {filename, mtime, stream, isDirectory, compression, size} of files){
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

    const flag_bits = (isDirectory? 0: flags.USE_DATA_DESCRIPTOR) | flags.UTF_FILENAME;
    const extra :ExtraData = new Map();
    const zip64File :boolean =   (!isDirectory && (!size || 0xffffffff <= size))
                              || 0xffffffff <= local_header_offset;
    if(zip64File){
      log.zip64(`Use Zip64 extra field for ${filename}`);
      extra.set(0x0001, create_zip64_extra_field({size: 0, compressedSize: 0, offset: local_header_offset}));
    }
    log.entries(`Adding ${filename} to archive`);
    //File header
    let header = create_file_header({filename, mtime, flags: flag_bits, compression, extra});
    yield header; 
    archive_size += header.length;
    //End of file header

    let realSize = 0, compressedSize = 0, crc = 0;
    if(stream){
      let sum = crc32();
      let dataStream = stream.pipe(new Transform({
        transform(chunk, encoding, callback){
          sum.next(chunk);
          realSize += chunk.length;
          callback(null, chunk);
        }
      }))

      if(compression === ECompression.DEFLATE){
        log.compression(`Compressing ${filename} with DEFLATE`);
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
      if(compression !== ECompression.NO_COMPRESSION) log.compression(`Compressed ${filename} to ${compressedSize} (${Math.round(100*(1-compressedSize/realSize))}%)`);
      
      crc = sum.next().value;

      /** @todo: [strict mode] verify against provided crc/size/compressedSize if provided */
      //Data descriptor
      let dd = (extra.has(0x0001)? create_zip64_data_descriptor : create_data_descriptor)({size: realSize, compressedSize, crc});
      yield dd;
      archive_size += dd.length;
      log.entries(`Added ${filename} to archive with checksum 0x${crc.toString(16).padStart(8, "0")}`);
    }else{
      log.entries(`Added ${filename} to archive`);
    }
   
    if(zip64File){
      //Rewrite the extra field to have real values
      extra.set(0x0001, create_zip64_extra_field({size: realSize, compressedSize, offset: local_header_offset}));
    }

    //Construct central directory record for later use
    let cdr = create_cd_header({
      filename,
      compression,
      compressedSize: Math.min(compressedSize, 0xffffffff),
      size: Math.min(realSize, 0xffffffff),
      crc,
      flags: flag_bits,
      mtime,
      dosMode: (isDirectory? 0x10: 0),
      unixMode: parseInt((isDirectory? "040755":"100644"), 8),
      offset: Math.min(local_header_offset, 0xffffffff),
      extra,
    });

    //Append to central directory buffer
    cd = Buffer.concat([cd, cdr]);
  }

  // Digital signature is omitted until we support encryption
  // It would be appended to `cd`
  yield cd;

  const is_zip64 =  0xffffffff <= archive_size || 0xffffffff <= cd.length || 0xffff <= files_count;
  if(is_zip64){
    log.zip64("Create Zip64 end of central directory record");
    yield create_zip64_eocd_record({
      files_count,
      cd_length: cd.length,
      data_length: archive_size,
    });
  }

  //End of central directory
  yield create_eocd_record({
    files_count: Math.min(files_count, 0xffff),
    cd_length: Math.min(cd.length, 0xffffffff),
    data_length: Math.min(archive_size, 0xffffffff),
    comments,
  });
  log.entries("Archive complete");
}


/**
 * Scan a file from the end to find the location of the "End of Central Directory" record
 * Will resolve the Zip64 end of central directory record if necessary
 */
export async function find_eocd_record(handle :FileHandle, strict = false) :Promise<EOCDRecord>{
  let stats = await handle.stat();
  let slice = await (async ()=>{
    //We expect comments to be below 65kb.
    let b = Buffer.alloc(65535);
    let {bytesRead} = await handle.read({buffer: b, position: Math.max(stats.size - 65535, 0)});
    let offset = find_eocd_index(b, bytesRead);
    if(offset < 0){
      throw new Error("Could not find end of central directory record");
    }
    return b.subarray(offset);
  })();

  const eocd = parse_eocd_record(slice);
  if(!(eocd.data_length == 0xffffffff
    || eocd.cd_length == 0xffffffff 
    || eocd.files_count == 0xffff
  )){
    return eocd;
  }
  
  const locator_offset = stats.size - slice.length - zip64_locator_length;
  log.zip64("Looking for Zip64 end of central directory record at index %d", locator_offset);
  let locator = Buffer.allocUnsafe(zip64_locator_length);
  let {bytesRead: locatorBytes} = await handle.read({buffer:locator, position: locator_offset});
  assert( locatorBytes == locator.length, `Can't read Zip64 End of Central Directory Locator (missing ${locator.length - locatorBytes} of ${locator.length} bytes)`);
  
  let zip64cd_offset = parse_zip64_eocd_locator(locator, strict);
  let zip64_eocd_buffer = Buffer.allocUnsafe(locator_offset - zip64cd_offset);
  let {bytesRead: recordBytes} = await handle.read({buffer: zip64_eocd_buffer, position: zip64cd_offset});
  assert( recordBytes == zip64_eocd_buffer.length, `Can't read Zip64 End of Central Directory Record (missing ${zip64_eocd_buffer.length - recordBytes} of ${zip64_eocd_buffer.length} bytes)`);
  let zip64_eocd = parse_zip64_eocd_record(zip64_eocd_buffer);
  return {...eocd, ...zip64_eocd};
}


/**
 * 
 * Iterate over a file's central directory headers
 * It only read the file once before the first loop so it's safe to just unwrap the iterator
 * the entry's offset and size includes the file header.
 */
export async function *read_cdh(handle : FileHandle, strict = false) :AsyncGenerator<CDHeader, void, void >{
  let eocd = await find_eocd_record(handle, strict);
  
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
export async function listEntries(filepath :string, strict?:boolean) :Promise<ZipExtractEntry[]>
  export async function listEntries(fd :FileHandle, strict?:boolean) :Promise<ZipExtractEntry[]>
export async function listEntries(file :string|FileHandle, strict = false) :Promise<ZipExtractEntry[]>{
  let handle = typeof file ==="string"? await fs.open(file, "r"):file;
  let entries = [];

  try{
    for await (let entry of read_cdh(handle, strict )){
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
