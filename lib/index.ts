import fs, {FileHandle} from "node:fs/promises";
import zlib from "node:zlib";
import assert from "node:assert/strict";

import { crc32 } from "./utils/crc32.js";

import {file_header_length, eocd_length, flags, ECompression} from "./constants.js";
import {CDHeader, ZipCentralOptions, ZipEntry, ZipExtractEntry} from "./types.js";

import {create_cd_header, parse_cd_header} from "./records/cd.js";
import {create_file_header} from "./records/file.js";
import {create_data_descriptor} from "./records/dd.js";
import {create_eocd_record, parse_eocd_record} from "./records/eocd.js";
import { Readable, Transform } from "node:stream";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";



export function isDirectory(h:CDHeader):boolean{
  return (h.dosMode & 0x10)?true:false;
}

/**
 * simple implementation of Zip to allow export
 * Should be compatible with standard implementations
 * @see https://pkware.cachefly.net/webdocs/APPNOTE/APPNOTE-6.3.0.TXT
 */
export async function *zip(files :AsyncIterable<ZipEntry>|Iterable<ZipEntry>, {comments = "", strict = false} :ZipCentralOptions={}) :AsyncGenerator<Buffer,void,unknown>{

  if(strict) console.warn("Strict mode not yet implemented");
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

    if(mtime.getUTCFullYear() < 1980){
      mtime = new Date("1980-01-01T0:0:0Z");
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

    //Append to central directory
    cd = Buffer.concat([cd, cdr]);
  }

  // Digital signature is omitted


  //End of central directory
  let eocdr = create_eocd_record({
    files_count,
    cd_length: cd.length,
    data_length: archive_size,
    comments,
  });
  //central directory is generally small enough to send in one chunk
  yield Buffer.concat([cd, eocdr]);
}


/**
 * search for an "end of central directory record" at the end of the file.
 * That is, something with 0x06054b50. Then check for false positives by verifying if comment length matches.
 */
async function get_eocd_buffer(handle :FileHandle) :Promise<Buffer>{
  let stats = await handle.stat();
  //We expect comments to be below 65kb.
  let b = Buffer.alloc(65535);
  let {bytesRead} = await handle.read({buffer: b, position: Math.max(stats.size - 65535, 0)});
  let offset = 0;
  for(offset; offset < bytesRead - eocd_length; offset++){
    //Find a eocd signature matching a correct comments length
    if(b.readUInt32LE(bytesRead -offset - eocd_length) == 0x06054b50 && b.readUInt16LE(bytesRead - offset-2) == offset){
      return b.slice(bytesRead - offset - eocd_length);
    }
  }
  throw new Error("Could not find end of central directory record");
}

export async function zip_read_eocd(handle :FileHandle){
  let slice = await get_eocd_buffer(handle);
  return parse_eocd_record(slice);
}


/**
 * 
 * Iterate over a file's central directory headers
 * It only read the file once before the first loop so it's safe to just unwrap the iterator
 * the entry's offset and size includes the file header.
 */
export async function *read_cdh(handle : FileHandle) :AsyncGenerator<CDHeader, void, void >{
  let eocd = await zip_read_eocd(handle);
  let cd = Buffer.allocUnsafe(eocd.cd_length);
  let bytes = (await handle.read({buffer:cd, position: eocd.data_length})).bytesRead;
  assert( bytes == cd.length, `Can't read Zip Central Directory Records (missing ${cd.length - bytes} of ${cd.length} bytes)`);
  let offset = 0;
  while(offset < eocd.cd_length){
    let {length, ...header} = parse_cd_header(cd, offset);
    yield header;
    offset = offset + length;
  }
}




/**
 * Unpacks a zip file to an iterator of ZipEntry
 * Can't work from a stream beacause it must read the end of the file (Central Directory) first.
 * It modifies the entry returned from parse_cd_header to exclude the file header and data descriptor
 */
export async function listEntries(filepath :string) :Promise<ZipExtractEntry[]>{
  let handle = await fs.open(filepath, "r");
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
        start:entry.offset+header_length,
        end: entry.offset+header_length + entry.compressedSize,
        isDirectory: isDirectory(entry),
      });
    }
  }finally{
    await handle.close();
  }
  return entries;
}

export function openEntry(filepath: string, entry :ZipExtractEntry) :Readable{

  let rs:Readable = createReadStream(filepath, {
    autoClose: true,
    start: entry.start,
    end: entry.end,
  })
  if(entry.compression == ECompression.NO_COMPRESSION){
    return rs;

  } else if(entry.compression == ECompression.DEFLATE){
    return rs.pipe(zlib.createInflateRaw());
  }else{
    rs.destroy(new Error(`Unsupported compression method : ${ECompression[entry.compression]?? entry.compression}`));
    return rs;
  }
}
