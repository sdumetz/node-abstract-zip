import assert from "assert";
import {cd_header_length} from "../constants.js";
import { CDHeader } from "../types.js";
import { DateTime } from "../utils/datetime.js";

export function create_cd_header({filename, mtime, extra="", dosMode, unixMode, size, compression, compressedSize = size, crc, flags, offset}:Partial<CDHeader>&Omit<CDHeader,"compressedSize">){
  let name_length = Buffer.byteLength(filename);
  let extra_length = Buffer.byteLength(extra);
  //Construct central directory record
  let cdr = Buffer.allocUnsafe(cd_header_length + name_length + extra_length);
  
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
  cdr.writeUInt16LE(extra_length, 30); // extra field length
  cdr.writeUInt16LE(0, 32); //comment length
  cdr.writeUInt16LE(0, 34) //disk number
  cdr.writeUInt16LE(0, 36) //Internal attributes. Indicate ASCII files here
  cdr.writeUInt16LE(dosMode, 38) //DOS directory or archive (first two bytes of external attributes
  cdr.writeUInt16LE(unixMode, 40)// external attributes (unix mode)
  cdr.writeUInt32LE(offset, 42); //relative offset of file header
  cdr.write(filename, cd_header_length, "utf-8");
  cdr.write(extra, cd_header_length + name_length, "utf-8");
  
  return cdr;
}

export function parse_cd_header(cd :Buffer, offset :number) :CDHeader & {length:number}{
  let cdh = cd.slice(offset, offset + cd_header_length);
  const signature = cd.readUInt32LE(0);
  assert(signature === 0x02014b50,`Expect header to begin with 0x02014b50 but found 0x${signature.toString(16)}`)
  let mtime = DateTime.toUnix(cdh.readUInt32LE(12));
  let name_length = cdh.readUInt16LE(28);
  let extra_length = cdh.readUInt16LE(30);
  return {
    filename: cd.slice(offset+cd_header_length, offset + cd_header_length +name_length).toString("utf-8"),
    extra: cd.slice(offset + cd_header_length + name_length, offset + cd_header_length + name_length + extra_length).toString("utf-8"),
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