import assert from "node:assert";
import { debuglog } from "node:util";

import {cd_header_length} from "../constants.js";
import { CDHeader } from "../types.js";
import { DateTime } from "../utils/datetime.js";
import {create_extra_header, parse_extra_header} from "./extra.js";
import { parse_zip64_extra_field } from "./zip64.js";

import * as log from "../utils/debug.js";

export function create_cd_header({filename, mtime, extra = new Map(), dosMode, unixMode, size, compression, compressedSize = size, crc, flags, offset}:Partial<CDHeader>&Omit<CDHeader,"compressedSize">){
  let name_length = Buffer.byteLength(filename);
  let extraData = create_extra_header(extra);
  //Construct central directory record
  let cdr = Buffer.allocUnsafe(cd_header_length + name_length + extraData.length);
  
  cdr.writeUInt32LE(0x02014b50, 0); // Signature
  cdr.writeUInt16LE( 3 << 8 | 20, 4); // made by UNIX with zip v2.0
  cdr.writeUInt16LE(20, 6); // need version 2.0 to extract
  cdr.writeUInt16LE(flags, 8); //General purpose flags
  cdr.writeUInt16LE(compression, 10); // Compression
  cdr.writeUInt32LE(DateTime.toDos(mtime), 12) // last mod file time & date
  cdr.writeUInt32LE(crc, 16) //crc-32
  cdr.writeUInt32LE(compressedSize, 20); // compressed size
  cdr.writeUInt32LE(size, 24); // uncompressed size
  cdr.writeUInt16LE(name_length, 28); // file name length
  cdr.writeUInt16LE(extraData.length, 30); // extra field length
  cdr.writeUInt16LE(0, 32); //comment length
  cdr.writeUInt16LE(0, 34) //disk number
  cdr.writeUInt16LE(0, 36) //Internal attributes. Indicate ASCII files here
  cdr.writeUInt16LE(dosMode, 38) //DOS directory or archive (first two bytes of external attributes
  cdr.writeUInt16LE(unixMode, 40)// external attributes (unix mode)
  cdr.writeUInt32LE(offset, 42); //relative offset of file header
  cdr.write(filename, cd_header_length, "utf-8");
  extraData.copy(cdr, cd_header_length + name_length );
  
  return cdr;
}

export function parse_cd_header(cd :Buffer, offset :number) :Required<CDHeader> & {length:number}{
  let cdh = cd.slice(offset, offset + cd_header_length);
  const signature = cd.readUInt32LE(0);
  assert(signature === 0x02014b50,`Expect header to begin with 0x02014b50 but found 0x${signature.toString(16)}`)
  let mtime = DateTime.toUnix(cdh.readUInt32LE(12));
  let name_length = cdh.readUInt16LE(28);
  let extra_length = cdh.readUInt16LE(30);
  let extra = parse_extra_header(cd.subarray(offset+cd_header_length + name_length, offset+cd_header_length + name_length + extra_length));
  return {
    filename: cd.slice(offset+cd_header_length, offset + cd_header_length +name_length).toString("utf-8"),
    extra,
    // 0 header signature
    // 4 version made by
    // 6 version needed
    flags: cdh.readUInt16LE(8),
    compression: cdh.readUInt16LE(10),
    // 12 last mod time
    //14 last mod date
    mtime,
    crc: cdh.readUInt32LE(16),
    compressedSize: cdh.readUInt32LE(20), // 20 compressed size
    size: cdh.readUInt32LE(24),
    // 28 file name length
    // 30 extra field length
    // 32 comment length
    // 34 disk number start
    // 36 internal file attributes
    dosMode: cdh.readUInt16LE(38),
    unixMode: cdh.readUInt16LE(40),
    offset: cdh.readUInt32LE(42),
    length: cd_header_length + name_length + extra_length
  }
}
/**
 * Full parser for central directory headers
 * 
 */
export function *parse_cd(cd :Buffer) :Generator<CDHeader,void, void>{
  let offset = 0;
  while(offset < cd.length){
    let {length, ...header} = parse_cd_header(cd, offset);
    let zip64FieldBuffer = header.extra.get(0x0001);
    if(zip64FieldBuffer){
      log.zip64(`Parse Central Directory Zip64 extra header for ${header.filename}`);
      let zip64Field = parse_zip64_extra_field(zip64FieldBuffer);
      header = {...header, ...zip64Field};
      header.extra.delete(0x0001);
    }
    yield header;
    offset = offset + length;
  }
}